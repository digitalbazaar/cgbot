var fs = require('fs');
var ini = require('ini');
var irc = require('irc');
var lockfile = require('lockfile');
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
var speakerQueue = [];
var ircChannel = '#' + config.irc.channel;
var asteriskClient;

// connect to the IRC channel
var ircClient = new irc.Client(config.irc.server, config.irc.nick, {
  userName: 'voipbot',
  realName: 'Digital Bazaar VoIP bot',
  port: parseInt(config.irc.port, 10),
  channels: [ircChannel]
});

// says the given message in the main irc channel
var say = ircClient.say.bind(ircClient, ircChannel);

// hook up an error handler to prevent exit on error
ircClient.on('error', function(message) {
  console.log('error: ', message);
});

// handle channel join event
ircClient.on('join', function(channel, nick, message) {
  if(nick !== config.irc.nick) {
    return;
  }
  // connect to the Asterisk server
  asteriskClient = new Asterisk(
    config.asterisk.port, config.asterisk.server, config.asterisk.username,
    config.asterisk.password, true);
  asteriskClient.keepConnected();

  // get a list of conference participants on join
  asteriskClient.on('connect', function(event) {
    asteriskClient.action({
      action: 'confbridgelist',
      conference: config.asterisk.conference
    }, function(err, res) {
      if(err) {
        if(err.message === 'No active conferences.') {
          say('No one is on the conference bridge.');
          shutdown();
        } else {
          say('Failed to get list of participants.');
          console.log('Failed to get list of participants: ', err);
        }
      }
    });
  });

  // announce when people join the conference
  asteriskClient.on('confbridgejoin', function(event) {
    if(event.conference === config.asterisk.conference) {
      participants[event.channel] = event;
      say(prettyPrintChannel(event.channel) + ' has joined the conference.');
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
      if(Object.keys(participants).length === 0) {
        say('No one is on the conference bridge.');
        shutdown();
      }
    }
  });

  // listen to IRC channel messages
  ircClient.on('message#' + config.irc.channel, function(nick, message) {
    // handle non-voipbot directed channel commands
    var args = message.split(' ');
    var command = args.shift();
    if(command.search(/^q\+/) === 0) {
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
    if(command.search(/^q\-/) === 0) {
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
    if(command.search(/^q\?/) === 0 && args.length === 0) {
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
        say('No one is on the conference bridge.');
        shutdown();
        return;
      }
      say('Conference participants are: ' + participantList.join(', ') + '.');
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

function shutdown() {
  asteriskClient.disconnect();
  say('Shutting down and leaving...');
  ircClient.part(ircChannel);
  lockfile.unlockSync(lockFilename);
  process.exit();
}
