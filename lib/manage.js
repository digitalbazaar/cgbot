/*!
 * Copyright (c) 2020 Digital Bazaar, Inc. All rights reserved.
 */
import {connect as xmppConnect} from './xmpp.js';
import {connect as ircConnect} from './irc.js';
import {log, getLogUrl} from './log.js';
import ltxSerialize from 'ltx/lib/stringify';
import process from 'process';
import {processCommand} from './command.js';
import {v4 as uuidv4} from 'uuid';
import {xml} from '@xmpp/client';

export async function manage({meeting, meetings, xmppOptions}) {
  const xmppClient = xmppConnect(xmppOptions);
  const {ircOptions} = meetings[meeting];
  const ircClient = ircConnect(ircOptions);
  const participants = {};
  const polls = {byId: {}, idsByNum: {}, voterIdsByNick: {}, count: 0};
  const logFileBasePath = `${ircOptions.log}-${meeting}`;
  let announcedPresence = false;
  let recorded = false;

  xmppClient.on('online', async address => {
    if(xmppOptions.debug) {
      console.log('XMPP MANAGE online as', address.toString());
    }
    await _joinXmppMuc({meeting, xmppClient});
  });

  // handle channel join event
  ircClient.on('join', function(channel, nick) {
    if(ircOptions.nick !== nick) {
      return;
    } else {
      if(ircOptions.debug) {
        console.log('IRC joined', ircOptions.server, channel, 'as', nick);
      }
    }

    // listen to IRC channel messages
    const ircSay = ircClient.say.bind(ircClient, channel);

    xmppClient.on('stanza', async stanza => {
      if(xmppOptions.debug) {
        console.log('\n' + ltxSerialize(stanza, 2) + '\n');
      }

      // presence information (joining and leaving the audio bridge)
      if(stanza.is('presence')) {
        const beforeCount = Object.keys(participants).length;
        if(stanza.attrs.type === 'unavailable') {
          const from = stanza.attrs.from;
          const participant = participants[from];
          if(participant) {
            ircSay(participant.name + ' left the meeting.');
            delete participants[from];
          }
        } else if(stanza.getChild('nick')) {
          const from = stanza.attrs.from;
          const name = stanza.getChild('nick').text();
          const nick = stanza.getChild('nick').text().replace(/ /g, '_');
          const participant = {id: from, name, handUp: false};
          if(participants[from] === undefined ||
            participants[from].name.length < 1) {
            participants[from] = participant;
            if(participant.name.length > 0) {
              ircSay(participant.name + ' joined the meeting.');
              // log presence
              if(participant.name !== 'CG Bot' && ircOptions.log) {
                if(nick === 'Transcriber') {
                  // add to scribe list
                  let info = nick + ': scribe+';
                  ircSay(info);
                  xmppSay({info, meeting, xmppClient});
                  log({logFileBasePath, nick, message: 'scribe+'});

                  // set meeting
                  info = nick + ': Meeting: ' + meeting;
                  ircSay(info);
                  xmppSay({info, meeting, xmppClient});
                  log({logFileBasePath, nick, message: 'Meeting: ' + meeting});
                } else {
                  const info = nick + ': present+';
                  ircSay(info);
                  xmppSay({info, meeting, xmppClient});
                  log({logFileBasePath, nick, message: 'present+'});
                }
              }
            }

            // Announce that cgbot is here if it hasn't already done so
            if(!announcedPresence) {
              const logUrl =
                getLogUrl({logFileBasePath, logUrl: ircOptions.logUrl});
              const info = `Logging to ${logUrl}`;
              ircSay(info);
              xmppSay({info, meeting, xmppClient});
              announcedPresence = true;
            }
          }
        }

        // clean up if we're the last ones left
        const afterCount = Object.keys(participants).length;
        if(afterCount === 1 && beforeCount > 1) {
          const logUrl =
            getLogUrl({logFileBasePath, logUrl: ircOptions.logUrl});

          let info = `Raw transcript at ${logUrl}`;
          ircSay(info);
          xmppSay({info, meeting, xmppClient});

          if(recorded) {
            const oggUrl = logUrl.replace('-irc.log', '.ogg');
            info = `Raw audio at ${oggUrl}`;
            ircSay(info);
            xmppSay({info, meeting, xmppClient});

            const mp4Url = logUrl.replace('-irc.log', '.mp4');
            info = `Raw video at ${mp4Url}`;
            ircSay(info);
            xmppSay({info, meeting, xmppClient});
          }

          ircSay('The meeting has ended.');

          process.kill(process.pid, 'SIGINT');
        }
      }

      // handle XMPP-based queueing by raising hand
      if(stanza.is('presence') &&
        stanza.getChild('jitsi_participant_raisedHand')) {
        const from = stanza.attrs.from;
        const participant = participants[from];
        const nick = participant.name.replace(/ /g, '_');
        const handUp =
          stanza.getChild('jitsi_participant_raisedHand').text().length > 0;
        if(participant) {
          if(!participant.handUp && handUp) {
            const command = 'q+';
            processCommand(
              {nick, message: command, participants, say: async message => {
                const queueMessage = `${nick}: ${command}`;
                ircSay(queueMessage);
                await xmppSay({info: queueMessage, meeting, xmppClient});
                ircSay(message);
                await xmppSay({info: message, meeting, xmppClient});
              }});
          } else if(participant.handUp && !handUp) {
            const command = 'q-';
            processCommand(
              {nick, message: command, participants, say: async message => {
                const queueMessage = `${nick}: ${command}`;
                ircSay(queueMessage);
                await xmppSay({info: queueMessage, meeting, xmppClient});
                ircSay(message);
                await xmppSay({info: message, meeting, xmppClient});
              }});
          }
          participants[from].handUp = handUp;
        }
      }

      // group chat message
      if(stanza.attrs.type === 'groupchat') {
        if(stanza.attrs.from in participants) {
          const nick = participants[stanza.attrs.from].name.replace(/ /g, '_');
          const jsonMessageNode = stanza.getChild('json-message');
          const bodyNode = stanza.getChild('body');
          let msg;
          if(jsonMessageNode) {
            try {
              msg = JSON.parse(jsonMessageNode.text());
            } catch(e) {
              console.error('Bad json-message from ' + stanza.attrs.from);
              return;
            }
          }

          // the message is a transcription message
          if(msg && msg.event == 'SPEECH' && !msg.is_interim) {
            const commenter = msg.participant.name.replace(/ /g, '_');
            const rawMessage = msg.transcript[0].text + '.';
            const message = commenter + ': ' +
              rawMessage[0].toUpperCase() + rawMessage.slice(1);
            if(ircOptions.log) {
              log({logFileBasePath, nick, message});
            }
            ircSay(`${nick}: ${message}`);
            await xmppSay({info: `${nick}: ${message}`, meeting, xmppClient});
          }

          // the message is a new poll message
          if(msg && msg.type === 'new-poll') {
            if(!Array.isArray(msg.answers)) {
              console.error('Poll with non-array answers');
              return;
            }
            const pollNum = ++polls.count;
            polls.byId[msg.pollId] = {num: pollNum, msg, votes: {}};
            polls.idsByNum[pollNum] = msg.pollId;
            const numOptions = msg.answers.length;
            // If the poll is created from IRC, the participant/nick is the
            // bot, so use senderName instead.
            const bridged = stanza.attrs.from.endsWith('/cgbot');
            const name = bridged ? msg.senderName : nick;
            const message = `${name} created a poll #${pollNum} with ${numOptions} options.`;
            ircSay(message);
            if(ircOptions.log) {
              log({logFileBasePath, nick: ircOptions.nick, message});
            }
            const message2 = `POLL: ${msg.question}`;
            ircSay(message2);
            if(ircOptions.log) {
              log({logFileBasePath, nick: ircOptions.nick, message: message2});
            }
            msg.answers.forEach(async (option, i) => {
              const message = `... Option ${i+1}: ${option}`;
              ircSay(message);
              if(ircOptions.log) {
                log({logFileBasePath, nick: ircOptions.nick, message});
              }
            });
          }

          // the message is a poll answer message
          if(msg && msg.type === 'answer-poll') {
            const poll = polls.byId[msg.pollId];
            if(!poll) {
              console.error('Unknown poll ' + msg.pollId);
              return;
            }
            const answers = poll.msg.answers;
            poll.votes[msg.voterId] = msg;
            const message = `${msg.voterName} answered poll #${poll.num}: `
              + msg.answers.map((chosen, i) => chosen
                ? `(${i+1}) ${answers[i]}` : '')
                .filter(Boolean).join(', ');
            ircSay(message);
            if(ircOptions.log) {
              log({logFileBasePath, nick: ircOptions.nick, message});
            }
          }

          // the message is a normal groupchat message
          if(bodyNode) {
            const message = bodyNode.text();
            const replay = (stanza.getChild('delay')) ? true : false;
            if(nick !== 'CG_Bot' && !replay) {
              // log XMPP messages to logfile
              if(ircOptions.log) {
                log({logFileBasePath, nick, message});
              }
              ircSay(`${nick}: ${message}`);
              processCommand(
                {nick, message, participants, say: async message => {
                  ircSay(message);
                  await xmppSay({info: message, meeting, xmppClient});
                },
                msg: async message => {
                  await xmppMsg({msg: message, meeting, xmppClient});
                }});
            }
          }
        }
      }

      // recording stopped or started
      if(stanza.is('presence') &&
        stanza.getChild('jibri-recording-status')) {
        const recStatus =
          stanza.getChild('jibri-recording-status').attrs.status;
        if(recStatus === 'on') {
          recorded = true;
          ircSay('This meeting is now being recorded.');
        } else if(recStatus === 'off') {
          ircSay('The recording for this meeting has ended.');
        }
      }
    });

    ircClient.on('message' + channel, async (nick, message) => {
      // log IRC messages to logfile if a recording log prefix is specified
      if(ircOptions.log) {
        log({logFileBasePath, nick, message});
      }

      // echo from IRC to XMPP
      await xmppSay({info: `${nick}: ${message}`, meeting, xmppClient});
      processCommand({nick, message, participants, polls,
        say: async message => {
          ircSay(message);
          await xmppSay({info: message, meeting, xmppClient});
        },
        msg: async message => {
          await xmppMsg({msg: message, meeting, xmppClient});
        }
      });
    });

    // start the XMPP client once all handlers are setup
    xmppClient.start().catch(console.error);
  });
}

async function _joinXmppMuc({meeting, xmppClient}) {
  const xmppMessage = xml(
    'presence',
    {
      from: xmppClient.jid.toString(),
      id: uuidv4(),
      to: `${meeting}@conference.${xmppClient.jid._domain}/cgbot`
    },
    xml('nick', 'http://jabber.org/protocol/nick', 'CG Bot'),
    xml('x', 'http://jabber.org/protocol/muc')
  );

  await xmppClient.send(xmppMessage);
}

async function xmppSay({info, meeting, xmppClient}) {
  const xmppMessage = xml(
    'message',
    {
      from: xmppClient.jid.toString(),
      id: uuidv4(),
      to: `${meeting}@conference.${xmppClient.jid._domain}`,
      type: 'groupchat'
    },
    xml('nick', 'http://jabber.org/protocol/nick', 'CG Bot'),
    xml('body', {}, info)
  );

  await xmppClient.send(xmppMessage);
}

async function xmppMsg({msg, meeting, xmppClient}) {
  const xmppMessage = xml(
    'message',
    {
      from: xmppClient.jid.toString(),
      to: `${meeting}@conference.${xmppClient.jid._domain}`,
      type: 'groupchat'
    },
    xml('json-message', 'http://jitsi.org/jitmeet', JSON.stringify(msg)),
  );

  await xmppClient.send(xmppMessage);
}
