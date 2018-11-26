var async = require('async');
var aws = require('aws-sdk');
var fs = require('fs');
var ini = require('ini');
var irc = require('irc');
var lockfile = require('lockfile');
var path = require('path');
var Asterisk = require('asterisk-manager');

// read the config file
var configFilename = process.argv[2];
var config = ini.parse(fs.readFileSync(configFilename, 'utf-8'));

// create a lockfile that goes stale after 130 minutes
var lockFilename = '/var/tmp/voipbot-' + config.asterisk.conference +
  '-' + config.irc.channel + '.lock';
try {
  lockfile.lockSync(lockFilename, {stale: 7800000});
} catch(e) {
  console.log('error: Another voipbot instance exists: ', e, lockFilename);
  process.exit(1);
}

// cleanup the lockfile if there is an uncaught exception or an interrupt
process.on('uncaughtException', function(err) {
  console.log('uncaught exception: ', err.stack);
  lockfile.unlockSync(lockFilename);
  process.exit(1);
});
process.on('SIGINT', function() {
  console.log('info:', 'Cleaning up lock file and exiting.');
  lockfile.unlockSync(lockFilename);
  process.exit(1);
});

// shared variables
var participants = {};
var participantAudio = {};
var speakerQueue = [];
var ircChannel = '#' + config.irc.channel;
var ircChannelWithOptPass = '#' + config.irc.channel;
var asteriskClient;

// check to see if there is a channel password
if(config.irc.chanpass) {
  ircChannelWithOptPass += ' ' + config.irc.chanpass;
}

// connect to the IRC channel
var ircOptions = {
  userName: 'voipbot',
  realName: 'Digital Bazaar VoIP bot',
  port: parseInt(config.irc.port, 10),
  channels: [ircChannelWithOptPass]
};

// check if TLS should be used to connect
if(config.irc.port === '6697') {
  ircOptions.secure = true;
  ircOptions.selfSigned = true;
}

// check to see if the server requires a password
if(config.irc.servpass) {
  ircOptions.password = config.irc.servpass;
}

var ircClient = new irc.Client(config.irc.server, config.irc.nick, ircOptions);

// says the given message in the main irc channel
var say = ircClient.say.bind(ircClient, ircChannel);

// hook up an error handler to prevent exit on error
ircClient.on('error', function(message) {
  if(_shutdown) {
    return exit();
  }
  console.log('error: ', message);
});

// handle channel join event
ircClient.on('join', function(channel, nick, message) {
  if(nick !== config.irc.nick || _shutdown) {
    return;
  }
  // connect to the Asterisk server
  asteriskClient = new Asterisk(
    config.asterisk.port, config.asterisk.server, config.asterisk.username,
    config.asterisk.password, true);
  asteriskClient.keepConnected();

  // get a list of conference participants on join
  asteriskClient.on('connect', function(event) {
    say('Conference started.');
    asteriskClient.action({
      action: 'confbridgelist',
      conference: config.asterisk.conference
    }, function(err, res) {
      if(err) {
        if(err.message === 'No active conferences.') {
          say('No one is in the conference.');
          shutdown();
        } else {
          say('Failed to get list of participants.');
          console.log('Failed to get list of participants: ', err);
        }
      }
    });
  });

  asteriskClient.on('close', function(event) {
    shutdown();
  });

  // announce when people join the conference
  asteriskClient.on('confbridgejoin', function(event) {
    if(event.conference === config.asterisk.conference) {
      participants[event.channel] = event;
      say(prettyPrintChannel(event.channel) + ' has joined the conference.');
    }
  });

  // confbridge talking the recording file
  asteriskClient.on('confbridgetalking', function(event) {
    if(event.conference === config.asterisk.conference) {
      // current time in seconds since epoch
      var now = Math.floor(new Date().valueOf() / 1000);

      if(event.talkingstatus === "on") {
        participantAudio[event.channel] = event;
        participantAudio[event.channel].starttime = now;
      } else {
        if(participantAudio[event.channel]) {
          participantAudio[event.channel].stoptime = now;
        }
      }

      // clear audio events older than 3 minutes
      Object.keys(participantAudio).forEach(function(key) {
        var audio = participantAudio[key];
        if(now - audio.starttime > 180) {
          delete participantAudio[key];
        }
      });
    }
  });

  // build the list of participants
  asteriskClient.on('confbridgelist', function(event) {
    if(event.conference === config.asterisk.conference) {
      if(!(event.channel in participants)) {
        participants[event.channel] = event;
        say(prettyPrintChannel(event.channel) + ' is in the conference.');
      }
    }
  });

  // announce when people leave the conference
  asteriskClient.on('confbridgeleave', function(event) {
    if(event.conference === config.asterisk.conference) {
      say(prettyPrintChannel(event.channel) + ' has left the conference.');
      delete participants[event.channel];
      delete participantAudio[event.channel];
      if(Object.keys(participants).length === 0) {
        say('No one is in the conference.');
        shutdown();
      }
    }
  });

  // listen to IRC channel messages
  ircClient.on('message#' + config.irc.channel, function(nick, message) {
    if(_shutdown) {
      return;
    }

    // log IRC messages to logfile if a recording directory is specified
    if(config.asterisk.recordings) {
      var now = new Date();
      var date = now.toISOString().split('T')[0];
      var ircLog = path.join(config.asterisk.recordings, date + '-irc.log');
      var logLine = '[' + new Date().toISOString() + ']\t<' + nick + '>\t' +
        message + '\n';

      // log, ignoring all errors
      fs.appendFile(ircLog, logLine);
    }

    // handle non-voipbot directed channel commands
    var args = message.split(' ');
    var command = args.shift();
    if(command.search(/^(q|Q)\+/) === 0) {
      var queueEntry = {};
      var effectiveNick = nick;
      if(args.length === 1) {
        effectiveNick = args[0];
      } else if(args.length > 1) {
        queueEntry.reminder = args.join(' ');
      }
      queueEntry.nick = effectiveNick;
      speakerQueue.push(queueEntry);
      say(nick + ' has been added to the queue: ' +
        queueToString(speakerQueue));
    }
    if(command.search(/^ack/) === 0 && args.length === 1) {
      var speaker = removeFromQueue(speakerQueue, args[0]);
      if(speaker) {
        var reminder = '';
        if(speaker.reminder) {
          reminder = ' (' + speaker.reminder + ')';
        }
        say(speaker.nick + ' has the floor' + reminder + '.');
      } else {
        say(args[0] + ' isn\'t on the speaker queue.');
      }
    }
    if(command.search(/^(q|Q)\-/) === 0) {
      var effectiveNick = nick;
      if(args.length > 0) {
        effectiveNick = args[0];
      }
      var speaker = removeFromQueue(speakerQueue, effectiveNick);
      if(speaker) {
        say(speaker.nick + ' has been removed from the queue: ' +
          queueToString(speakerQueue));
      } else {
        say(args[0] + ' isn\'t on the speaker queue.');
      }
    }
    if(command.search(/^(q\?|Q|q)/) === 0 && args.length === 0) {
      if(speakerQueue.length === 0) {
        say('The speaker queue is empty.');
      } else {
        say('The current speaker queue is: ' + queueToString(speakerQueue));
      }
    }

    // handle voipbot specific commands

    var voipbotRegex = new RegExp('^voip.*:', 'i');
    if(!voipbotRegex.test(message)) {
      return;
    }

    args = message.split(' ');
    // all commands must contain at least the command name which is
    // the second argument
    if(args.length < 2) {
      return;
    }

    args.shift();
    command = args.shift();

    // show list of participants
    var channel = 'unknown';
    if(command.search(/^connections.*/) === 0 && args.length === 0) {
      var participantList = Object.keys(participants).map(function(channel) {
        return prettyPrintChannel(channel);
      });
      if(participantList.length < 1) {
        say('No one is in the conference.');
        shutdown();
        return;
      }
      say('Conference participants are: ' + participantList.join(', ') + '.');
      return;
    }
    if(command.search(/^number.*/) === 0 && args.length === 0) {
      var sip = config.asterisk.sip ||
        config.asterisk.conference + '@digitalbazaar.com';
      var pstn = config.asterisk.pstn ||
        'US: +1.540.274.1034 x' + config.asterisk.conference +
        ' - EU: +33.9.74.59.31.06 x' + config.asterisk.conference;
      sip = 'sip:' + sip;
      say('You may dial in using the free/preferred option - ' + sip +
        ' - or the expensive option - ' + pstn);
      return;
    }
    if(command.search(/^noise.*/) === 0 && args.length === 0) {
      // current time in seconds since epoch
      var now = Math.floor(new Date().valueOf() / 1000);
      var noisyChannels = [];

      Object.keys(participantAudio).forEach(function(key) {
        var audio = participantAudio[key];
        var noiseSeconds = 0;
        if(audio.stoptime) {
          noiseSeconds = audio.stoptime - audio.starttime;
        } else {
          noiseSeconds = now - audio.starttime;
        }

        noisyChannels.push(
          audio.calleridname + ' [' + audio.channel + '] for ' +
          noiseSeconds + ' seconds');
      });

      if(noisyChannels.length > 0) {
        say('During the last three minutes, noise was detected on the ' +
          ' following channels: ' + noisyChannels.join(', '));
      } else {
        say('No noise detected on any channels.');
      }
      return;
    }
    if(command.search(/^publish.*/) === 0 && args.length === 0) {
      uploadLogfiles(function(err) {
        if(err) {
          console.error('Failed to upload log files', err);
        }
      });

      return;
    }
    if(command.search(/^help.*/) === 0 && args.length === 0) {
      say('Help is available here: http://bit.ly/2CR6pZK');
      return;
    }
    if(command.search(/^mute/) === 0 && args.length === 1) {
      channel = guessChannel(args[0]);
      if(!channel) {
        say('Failed to mute "' + args[0] + '"; unrecognized channel.');
        return;
      }
      asteriskClient.action({
        action: 'confbridgemute',
        conference: config.asterisk.conference,
        channel: channel
      }, function(err, res) {
        if(err) {
          say('Failed to mute ' + prettyPrintChannel(channel) + '.');
          return;
        }
        say('Muting ' + prettyPrintChannel(channel) + '.');
      });
      return;
    }
    if(command.search(/^unmute/) === 0 && args.length === 1) {
      channel = guessChannel(args[0]);
      if(!channel) {
        say('Failed to unmute "' + args[0] + '"; unrecognized channel.');
        return;
      }
      asteriskClient.action({
        action: 'confbridgeunmute',
        conference: config.asterisk.conference,
        channel: channel
      }, function(err, res) {
        if(err) {
          say('Failed to unmute ' + prettyPrintChannel(channel) + '.');
          return;
        }
        say('Unmuting ' + prettyPrintChannel(channel) + '.');
      });
      return;
    }
    if(command.search(/^disconnect/) === 0 && args.length === 1) {
      channel = guessChannel(args[0]);
      if(!channel) {
        say('Failed to disconnect "' + args[0] + '"; unrecognized channel.');
        return;
      }
      asteriskClient.action({
        action: 'confbridgekick',
        conference: config.asterisk.conference,
        channel: channel
      }, function(err, res) {
        if(err) {
          say('Failed to disconnect ' + prettyPrintChannel(channel) + '.');
          return;
        }
        say('Disconnecting ' + prettyPrintChannel(channel) + '.');
      });
      return;
    }
    if(args.length > 1 && args[0].search(/^is/) === 0) {
      channel = guessChannel(command);
      var name = args.slice(1).join(' ');
      if(name === 'me') {
        // 'me' is shorthand for using the person's IRC nick
        name = nick;
      }
      if(!channel) {
        say('Failed to associate "' + command + '"; unrecognized channel.');
        return;
      }
      // overwrite calleridname
      var event = participants[channel];
      event.calleridname = name;
      say('Associated ' + name + ' with ' + channel + '.');
      return;
    }
    if(command.search(/^self-destruct/) === 0 && args.length === 0) {
      shutdown();
      return;
    }

    say('Unknown command: ' + command + ' ' + args.join(' '));
  });
});

/*************************** Helper functions ******************************/

/**
 * Converts a queue to a string.
 *
 * @param queue the queue to convert to a string
 * @return a string representing the queue
 */
function queueToString(queue) {
  return (queue.map(function(queueEntry) { return queueEntry.nick }))
    .join(', ');
};

/**
 * Removes a given nick from a queue.
 *
 * @param queue the queue to modify.
 * @param nick the nickname to remove from the queue
 *
 * @return the removed value.
 */
function removeFromQueue(queue, nick) {
  for(var i = 0; i < queue.length; i++) {
    if(queue[i].nick === nick) {
      return queue.splice(i, 1)[0];
    }
  }
  return null;
};

/**
 * Pretty-prints a channel name for human readability.
 *
 * @param channel the channel name
 * @return the pretty-printed channel
 */
function prettyPrintChannel(channel) {
  var prettyPrintedChannel = 'unknown participant';

  if(channel in participants) {
    prettyPrintedChannel =
      participants[channel].calleridname + ' [' + channel + ']';
  }

  return prettyPrintedChannel;
}

/**
 * Attempts to guess a channel given some text. The test currently tries
 * to match the last section of the channel name.
 *
 * @param text the text to try and match against the end of the channel name.
 * @return the guessed channel name, or false if the guess failed.
 */
function guessChannel(text) {
  var guess = false;

  // must have at least two characters to attempt a guess
  if(text.length < 2) {
    return guess;
  }

  // guess by attempting to match the end of the channel name
  var channelRegex = new RegExp('.*' + text + '$');
  Object.keys(participants).forEach(function(participant) {
    if(channelRegex.test(participant)) {
      guess = participant;
    }
  });

  return guess;
}

var _shutdown = false;
function shutdown() {
  if(_shutdown) {
    return;
  }
  _shutdown = true;

  say('Performing administrative duties before leaving channel...')
  setTimeout(function() {
    // upload log files if they exist
    uploadLogfiles(function(err) {
      if(err) {
        console.error('Failed to upload log files', err);
      }

      asteriskClient.disconnect();
      ircClient.disconnect(
        'Shutting down.', function() {
        exit();
      });
    });
  }, 3000);
}

function exit() {
  if(!_shutdown) {
    asteriskClient.disconnect();
  }
  lockfile.unlockSync(lockFilename);
  process.exit();
}

// search a directory for a file matching regexp larger than fsize bytes
function getNewestFile(dir, regexp, fsize) {
  var newest = null;
  var files = fs.readdirSync(dir);
  var one_matched = 0;

  for(var i = 0; i < files.length; i++) {
    if(regexp.test(files[i]) == false)
      continue;
    else if(one_matched == 0) {
      newest = files[i];
      one_matched = 1;
      continue;
    }

    var f1_time = fs.statSync(path.join(dir, files[i])).mtime.getTime();
    var goodSize = fs.statSync(path.join(dir, files[i])).size > fsize;
    var f2_time = fs.statSync(path.join(dir, newest)).mtime.getTime();

    if((f1_time > f2_time) && goodSize) {
      newest = files[i];
    }
  }

  if(newest != null)
    return path.join(dir, newest);

  return null;
}

function uploadLogfiles(callback) {
  // return early if upload settings are not set
  if(!config.s3 || !config.s3.accesskeyid) {
    return callback();
  }

  var now = new Date();
  var date = now.toISOString().split('T')[0];
  var ircLog = path.join(config.asterisk.recordings, date + '-irc.log');
  // get latest audio file larger than 15MB
  var audioRecording = getNewestFile(
    config.asterisk.recordings, new RegExp('.*\.wav'), 15728640);

  // get latest audio and IRC logs
  var s3Server = config.s3.server || 'db.s3.digitalbazaar.com';
  var bucket = config.s3.bucket || 'tmp';
  var accessKeyId = config.s3.accesskeyid;
  var secretAccessKey = config.s3.secretaccesskey;
  var publishBaseUrl = 'https://' + s3Server;
  var ircLogUrl = publishBaseUrl + '/' + bucket + '/' + date + '-irc.log';
  var audioRecordingUrl = publishBaseUrl + '/' + bucket + '/' +
    date + '-audio.wav ...';

  var s3 = new aws.S3({
    endpoint: publishBaseUrl,
    accessKeyId: accessKeyId,
    secretAccessKey: secretAccessKey,
    s3ForcePathStyle: true, // needed with minio?
    signatureVersion: 'v4',
    sslEnabled: true
  });

  async.auto({
    readIrcLog: async.apply(fs.readFile, ircLog),
    readAudioRecording: async.apply(fs.readFile, audioRecording),
    uploadIrcLog: ['readIrcLog', function(results, callback) {
      // build S3 parameters
      var params = {
        Bucket: bucket,
        Key: date + '-irc.log',
        Body: results.readIrcLog,
        ContentType: 'text/plain'
      };

      s3.putObject(params, function(err) {
        if(err) {
          console.error('Failed to upload IRC log', err);
          say('Failed to upload IRC log.');
          return callback(err);
        }

        say('Published raw IRC log to ' + ircLogUrl);
        callback();
      });
    }],
    uploadAudioRecording: ['readAudioRecording', function(results, callback) {
      // build S3 parameters
      var params = {
        Bucket: bucket,
        Key: date + '-audio.wav',
        Body: results.readAudioRecording,
        ContentType: 'audio/wav'
      };

      s3.putObject(params, function(err) {
        if(err) {
          console.error('Failed to upload audio recording', err);
          say('Failed to upload audio recording.');
          return callback(err);
        }

        say('Published raw audio to ' + audioRecordingUrl);
        callback();
      });
    }]
  }, callback);
}
