var fs = require('fs');
var ini = require('ini');
var irc = require('irc');
var lockfile = require('lockfile');
var Asterisk = require('asterisk-manager');

// read the config file
var configFilename = process.argv[2];
var config = ini.parse(fs.readFileSync(configFilename, 'utf-8'));

// shared variables
var participants = {};
var ircChannel = '#' + config.irc.channel;

// create a lockfile that goes stale after 130 minutes
var lockFilename = '/var/tmp/voipbot-' + config.asterisk.conference +
  '-' + config.irc.channel + '.lock';
lockfile.lock(lockFilename, {wait: 500, stale: 7800000}, function(err) {
  if(err) {
    console.log('error: Another voipbot instance exists: ', err, lockFilename);
    process.exit(1);
  }
});

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

// connect to the IRC channel
var ircClient = new irc.Client(config.irc.server, config.irc.nick, {
  userName: 'voipbot',
  realName: 'Digital Bazaar VoIP bot',
  port: parseInt(config.irc.port, 10),
  channels: [ircChannel]
});

// hook up an error handler to prevent exit on error
ircClient.addListener('error', function(message) {
  console.log('error: ', message);
});

// hook up an error handler to prevent exit on error
ircClient.addListener('join', function(channel, nick, message) {
  // connect to the Asterisk server
  var asteriskClient = new Asterisk(
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
        ircClient.say(ircChannel, 'Failed to get list of participants.');
      }
    });
  });

  // announce when people join the conference
  asteriskClient.on('confbridgejoin', function(event) {
    if(event.conference === config.asterisk.conference) {
      participants[event.channel] = event;
      ircClient.say(ircChannel, prettyPrintChannel(event.channel) +
        ' has joined the conference.');
    }
  });

  // build the list of participants
  asteriskClient.on('confbridgelist', function(event) {
    if(event.conference === config.asterisk.conference) {
      if(!(event.channel in participants)) {
        participants[event.channel] = event;
        ircClient.say(ircChannel, prettyPrintChannel(event.channel) +
          ' is in the conference.');
      }
    }
  });

  // announce when people leave the conference
  asteriskClient.on('confbridgeleave', function(event) {
    if(event.conference === config.asterisk.conference) {
      ircClient.say(ircChannel, prettyPrintChannel(event.channel) +
        ' has left the conference.');
      delete participants[event.channel];
    }
  });

  // listen to IRC channel messages
  ircClient.addListener('message#' + config.irc.channel,
    function(nick, message) {
    var voipbotRegex = new RegExp('^voip.*:', 'i');
    if(voipbotRegex.test(message)) {
      var args = message.split(' ');
      // all commands must contain at least the command name
      if(args.length < 2) {
        return;
      } else {
        args.shift();
      }
      var command = args.shift();

      // show list of participants
      var channel = 'unknown';
      if(command.search(/^connections.*/) === 0) {
        var participantList = [];
        Object.keys(participants).forEach(function(channel) {
          participantList.push(prettyPrintChannel(channel));
        });
        if(Object.keys(participants).length < 1) {
          ircClient.say(ircChannel, 'No one is on the conference bridge.');
        } else {
          ircClient.say(ircChannel, 'Conference participants are: ' +
            participantList.join(', ') + '.');
        }
      } else if(command.search(/^mute/) === 0 && args.length > 0) {
        channel = guessChannel(args[0]);
        asteriskClient.action({
          action: 'confbridgemute',
          conference: config.asterisk.conference,
          channel: channel
        }, function(err, res) {
          if(err) {
            ircClient.say(ircChannel,
              'Failed to mute ' + prettyPrintChannel(channel) + '.');
            return;
          }
          ircClient.say(ircChannel,
            'Muting ' + prettyPrintChannel(channel) + '.');
        });
      } else if(command.search(/^unmute/) === 0 && args.length > 0) {
        channel = guessChannel(args[0]);
        asteriskClient.action({
          action: 'confbridgeunmute',
          conference: config.asterisk.conference,
          channel: channel
        }, function(err, res) {
          if(err) {
            ircClient.say(ircChannel,
              'Failed to unmute ' + prettyPrintChannel(channel) + '.');
            return;
          }
          ircClient.say(ircChannel,
            'Unmuting ' + prettyPrintChannel(channel) + '.');
        });
      } else if(command.search(/^disconnect/) === 0 && args.length > 0) {
        channel = guessChannel(args[0]);
        asteriskClient.action({
          action: 'confbridgekick',
          conference: config.asterisk.conference,
          channel: channel
        }, function(err, res) {
          if(err) {
            ircClient.say(ircChannel,
              'Failed to disconnect ' + prettyPrintChannel(channel) + '.');
            return;
          }
          ircClient.say(ircChannel,
            'Disconnecting ' + prettyPrintChannel(channel) + '.');
        });
      } else if(command.search(/^self-destruct/) === 0 && args.length === 0) {
        asteriskClient.disconnect();
        ircClient.say(ircChannel, 'Shutting down and leaving...');
        ircClient.part(ircChannel);
        lockfile.unlockSync(lockFilename);
        process.exit();
      }

    }
  });
});

/*************************** Helper functions ******************************/

/**
 * Pretty-prints a channel name for human readability.
 *
 * @param channel the channel name
 * @return the pretty-printed channel
 */
function prettyPrintChannel(channel) {
  var prettyPrintedChannel = "unknown participant";

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
