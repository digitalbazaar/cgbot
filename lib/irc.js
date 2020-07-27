import irc from 'irc';

// shared variables
const participants = {};
const participantAudio = {};
const speakerQueue = [];

export async function connect({server, channel, chanpass}) {

  const ircChannel = '#' + config.irc.channel;
  const ircChannelWithOptPass = '#' + config.irc.channel;

  // check to see if there is a channel password
  if(config.irc.chanpass) {
    ircChannelWithOptPass += ' ' + config.irc.chanpass;
  }

  // connect to the IRC channel
  const ircOptions = {
    userName: 'cgbot',
    realName: 'Digital Bazaar W3C CG Bot',
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

  const ircClient = new irc.Client(config.irc.server, config.irc.nick, ircOptions);

  // says the given message in the main irc channel
  const say = ircClient.say.bind(ircClient, ircChannel);

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

    // listen to IRC channel messages
    ircClient.on('message#' + config.irc.channel, function(nick, message) {
      if(_shutdown) {
        return;
      }

      // log IRC messages to logfile if a recording directory is specified
      if(config.asterisk.recordings) {
        const now = new Date();
        const date = now.toISOString().split('T')[0];
        const ircLog = path.join(config.asterisk.recordings, date + '-irc.log');
        const logLine = '[' + new Date().toISOString() + ']\t<' + nick + '>\t' +
          message + '\n';

        // log, ignoring all errors
        fs.appendFile(ircLog, logLine);
      }

      // handle non-voipbot directed channel commands
      const args = message.split(' ');
      const command = args.shift();
      if(command.search(/^(q|Q)\+/) === 0) {
        const queueEntry = {};
        const effectiveNick = nick;
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
        const speaker = removeFromQueue(speakerQueue, args[0]);
        if(speaker) {
          const reminder = '';
          if(speaker.reminder) {
            reminder = ' (' + speaker.reminder + ')';
          }
          say(speaker.nick + ' has the floor' + reminder + '.');
        } else {
          say(args[0] + ' isn\'t on the speaker queue.');
        }
      }
      if(command.search(/^(q|Q)\-/) === 0) {
        const effectiveNick = nick;
        if(args.length > 0) {
          effectiveNick = args[0];
        }
        const speaker = removeFromQueue(speakerQueue, effectiveNick);
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

      const voipbotRegex = new RegExp('^cgbot.*:', 'i');
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
      const channel = 'unknown';
      if(command.search(/^connections.*/) === 0 && args.length === 0) {
        const participantList = Object.keys(participants).map(function(channel) {
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
        const sip = config.asterisk.sip ||
          config.asterisk.conference + '@digitalbazaar.com';
        const pstn = config.asterisk.pstn ||
          'US: +1.540.274.1034 x' + config.asterisk.conference +
          ' - EU: +33.9.74.59.31.06 x' + config.asterisk.conference;
        sip = 'sip:' + sip;
        say('You may dial in using the free/preferred option - ' + sip +
          ' - or the expensive option - ' + pstn);
        return;
      }
      if(command.search(/^help.*/) === 0 && args.length === 0) {
        say('Help is available here: http://bit.ly/2CR6pZK');
        return;
      }

      if(command.search(/^self-destruct/) === 0 && args.length === 0) {
        shutdown();
        return;
      }

      say('Unknown command: ' + command + ' ' + args.join(' '));
    });
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
  for(const i = 0; i < queue.length; i++) {
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
  const prettyPrintedChannel = 'unknown participant';

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
  const guess = false;

  // must have at least two characters to attempt a guess
  if(text.length < 2) {
    return guess;
  }

  // guess by attempting to match the end of the channel name
  const channelRegex = new RegExp('.*' + text + '$');
  Object.keys(participants).forEach(function(participant) {
    if(channelRegex.test(participant)) {
      guess = participant;
    }
  });

  return guess;
}
