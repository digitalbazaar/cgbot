// shared variables
const speakerQueue = [];

export async function processCommand({nick, message, participants, say}) {
  // handle non-voipbot directed channel commands
  let args = message.split(' ');
  let command = args.shift();
  if(command.search(/^ack/) === 0 && args.length === 1) {
    const speaker = removeFromQueue(speakerQueue, args[0]);
    if(speaker) {
      let reminder = '';
      if(speaker.reminder) {
        reminder = ' (' + speaker.reminder + ')';
      }
      say(speaker.nick + ' has the floor' + reminder + '.');
    } else {
      say(args[0] + ' isn\'t on the speaker queue.');
    }
  }
  if(command.search(/^(\+q|\+Q|q\+|Q\+)/) === 0) {
    const queueEntry = {};
    let effectiveNick = nick;
    if(args.length === 1) {
      effectiveNick = args[0];
    } else if(args.length > 1) {
      queueEntry.reminder = args.join(' ');
    }
    queueEntry.nick = effectiveNick;
    speakerQueue.push(queueEntry);
    say(nick + ' has been added to the queue: ' +
      queueToString(speakerQueue));
  } else if(command.search(/^(\-q|\-Q|q\-|Q\-)/) === 0) {
    let effectiveNick = nick;
    if(args.length > 0) {
      effectiveNick = args[0];
    }
    const speaker = removeFromQueue(speakerQueue, effectiveNick);
    if(speaker) {
      say(speaker.nick + ' has been removed from the queue: ' +
        queueToString(speakerQueue));
    } else {
      const preamble = (args[0]) ? args[0] + ' isn\'t' : 'You aren\'t';
      say(preamble + ' on the speaker queue.');
    }
  } else if(command.search(/^(\?q|q\?|Q|q)/) === 0 && args.length === 0) {
    if(speakerQueue.length === 0) {
      say('The speaker queue is empty.');
    } else {
      say('The current speaker queue is: ' + queueToString(speakerQueue));
    }
  }

  // handle voipbot specific commands

  const voipbotRegex = new RegExp('^.*(cgbot|voip).*:', 'i');
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
  if(command.search(/^connections.*/) === 0 && args.length === 0) {
    const participantList = Object.values(participants).map(
      participant => `${participant.name} (${participant.id.substr(-4)})`);
    if(participantList.length < 1) {
      say('No one is in the conference.');
      return;
    }
    say('Conference participants are: ' + participantList.join(', ') + '.');
    return;
  }
  if(command.search(/^number.*/) === 0 && args.length === 0) {
    const sip = 'UNKNOWN';
    const pstn = 'UNKNOWN';
    say('You may dial in using the free/preferred option - ' + sip +
      ' - or the expensive option - ' + pstn);
    return;
  }
  if(command.search(/^.*help.*/) === 0 && args.length === 0) {
    say('Help is available here: http://bit.ly/2CR6pZK');
    return;
  }

  say('Unknown command: ' + command + ' ' + args.join(' '));
}

/*************************** Helper functions ******************************/

function queueToString(queue) {
  const queueString = (queue.length > 0) ?
    (queue.map(queueEntry => queueEntry.nick)).join(', ') :
    'no one is left on the queue.';

  return queueString;
}

function removeFromQueue(queue, nick) {
  for(let i = 0; i < queue.length; i++) {
    if(queue[i].nick.toLowerCase().startsWith(nick.toLowerCase())) {
      return queue.splice(i, 1)[0];
    }
  }
  return null;
}
