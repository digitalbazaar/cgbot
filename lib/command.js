// shared variables
import process from 'process';
import crypto from 'crypto';

// the current speaker queue
const speakerQueue = [];

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function getPoll(args, polls, say) {
  let pollNum;
  if(args.length > 0) {
    pollNum = args.shift().replace(/^#/, '');
    if(isNaN(pollNum)) {
      say('Expected poll number');
      return;
    }
  } else {
    if(polls.count === 0) {
      say('No polls.');
      return;
    }
    pollNum = polls.count;
  }
  if(args.length > 0) {
    say('Unexpected data after poll number')
    return;
  }
  const pollId = polls.idsByNum[pollNum];
  if(!pollId) {
    say(`Unknown poll "${pollNum}"`);
    return;
  }
  const poll = polls.byId[pollId];
  return poll;
}

export async function processCommand({nick, message, participants, polls, say, msg}) {
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
  if(command.search(/^shutdown/) === 0 && args.length === 0) {
    say('Cleanly shutting down.');
    process.kill(process.pid, 'SIGINT');
    return;
  }
  if(command == 'create' && args[0] === 'poll') {
    args.shift();
    const cmd = args.join(' ');
    const createArgs = cmd.split(/\s*\|\s*/).filter(Boolean);
    if(createArgs.length < 3) {
      say('Try: create poll QUESTION | OPTION 1 | OPTION 2 ...');
      return;
    }
    const question = createArgs.shift();
    const answers = createArgs;
    const senderId = polls.voterIdsByNick[nick] ||
      (polls.voterIdsByNick[nick] = sha256(nick).slice(-8));
    const newPollMsg = {
      type: 'new-poll',
      pollId: sha256(cmd).slice(-10),
      senderId,
      senderName: nick,
      question,
      answers
    };
    await msg(newPollMsg);
    return;
  }
  if(command === 'vote') {
    // "vote [option[s]] <number>[,...] [on [poll] [#]<number>]"
    if(args[0] === 'option' || args[0] === 'options') {
      args.shift();
    }
    if(args.length === 0) {
      say('Vote what option on what poll?');
      return;
    }
    let options = args.shift().split(/,\s*/);
    if(options.some(isNaN)) {
      say(`Expected numeric options (e.g. 1,2) instead of "${options}"`);
      return;
    }
    let pollNum;
    if(args.length > 0) {
      if(args[0] === 'on') {
        args.shift();
      } else {
        say('Try: vote option X on poll Y');
        return;
      }
      if(args[0] === 'poll') {
        args.shift();
      }
      if(args[0]) {
        pollNum = args.shift().replace(/^#/, '');
      }
    }
    const poll = pollNum
      ? polls.byId[polls.idsByNum[pollNum]]
      : polls.byId[polls.idsByNum[polls.count]];
    if(!poll) {
      say(`Unknown poll "${pollNum}"`);
      return;
    }
    const answersMap = {};
    for(const option of options) {
      const answerI = option-1;
      answersMap[answerI] = true;
      const answer = poll.msg.answers[answerI];
      if(answer == null) {
        say(`Unknown option "${option}"`);
        return;
      }
    }
    const answerBools = poll.msg.answers.map((_answer, i) => !!answersMap[i]);
    const voterId = polls.voterIdsByNick[nick]
      || (polls.voterIdsByNick[nick] = sha256(nick).slice(-8));
    const answerPollMsg = {
      type: 'answer-poll',
      pollId: poll.msg.pollId,
      voterId,
      voterName: nick,
      answers: answerBools
    };
    await msg(answerPollMsg);
    return;
  }
  if(command == 'poll' || command == 'poll?') {
    const poll = getPoll(args, polls, say);
    if(!poll) {
      return;
    }
    const numOptions = poll.msg.answers.length;
    say(`Poll #${poll.num} with ${numOptions} options.`);
    say(`... Question: ${poll.msg.question}`);
    poll.msg.answers.forEach(async (option, i) => {
      say(`... Option ${i+1}: ${option}`);
    });
    return;
  }
  if(command == 'polls' || command == 'polls?') {
    if(polls.count === 0) {
      say('No polls.');
      return;
    }
    if(args.length > 0) {
      say('Unexpected argument')
      return;
    }
    say(`${polls.count} polls.`);
    for(const pollNum in polls.idsByNum) {
      const pollId = polls.idsByNum[pollNum];
      const poll = polls.byId[pollId];
      say(`... Poll #${pollNum}: ${poll.msg.question}`);
    }
    return;
  }
  if(command == 'votes' || command == 'votes?') {
    const poll = getPoll(args, polls, say);
    if(!poll) {
      return;
    }
    // Sum up the votes, and list the voters, per option.
    const votesByAnswer = {};
    const numOptions = poll.msg.answers.length;
    let numVoters = 0;
    let numTotalVotes = 0;
    for(let i = 0; i < numOptions; i++) {
      votesByAnswer[i] = [];
    }
    for(const voterId in poll.votes) {
      numVoters++;
      const vote = poll.votes[voterId];
      const voteAnswers = vote.answers;
      for(let i = 0; i < numOptions; i++) {
        if(voteAnswers[i]) {
          votesByAnswer[i].push(vote);
          numTotalVotes++;
        }
      }
    }
    say(`Poll #${poll.num} with ${numOptions} options has ${numTotalVotes} votes from ${numVoters} voters.`);
    say(`... Question: ${poll.msg.question}`);
    poll.msg.answers.forEach(async (option, i) => {
      const votes = votesByAnswer[i];
      const percent = (votes.length / (numVoters || 1) * 100).toFixed() + '%';
      say(`... Option ${i+1} has ${votes.length} votes (${percent}); voted by: `
        + votes.map(vote => vote.voterName).join(', '));
    });
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
