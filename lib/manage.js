/*!
 * Copyright (c) 2020 Digital Bazaar, Inc. All rights reserved.
 */
import {connect as xmppConnect} from './xmpp.js';
import {connect as ircConnect} from './irc.js';
import {log} from './log.js';
import ltxSerialize from 'ltx/lib/stringify';
import {processCommand} from './command.js';
import {v4 as uuidv4} from 'uuid';
import {xml} from '@xmpp/client';

export async function manage({meeting, xmppOptions, meetings}) {
  const xmppClient = xmppConnect(xmppOptions);
  const {ircOptions} = meetings[meeting];
  const ircClient = ircConnect(ircOptions);
  const participants = {};

  xmppClient.on('online', async address => {
    if(xmppOptions.debug) {
      console.log('XMPP MANAGE online as', address.toString());
    }
    await _joinXmppMuc({meeting, xmppClient});
  });

  // handle channel join event
  ircClient.on('join', function(channel, nick) {
    if(nick !== nick) {
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
        if(stanza.attrs.type === 'unavailable') {
          const from = stanza.attrs.from;
          const participant = participants[from];
          if(participant) {
            ircSay(participant.name + ' left the meeting.');
            delete participants[from];
          }
        } else if(stanza.getChild('nick')) {
          const from = stanza.attrs.from;
          if(participants[from] === undefined) {
            const name = stanza.getChild('nick').text();
            const participant = {id: from, name};
            participants[from] = participant;
            ircSay(participant.name + ' joined the meeting.');
          }
        }
      }

      // group chat message
      if(stanza.attrs.type === 'groupchat') {
        if(stanza.getChild('nick')) {
          const nick = stanza.getChild('nick').text().replace(/ /g, '_');
          const message = stanza.getChild('body').text();
          const replay = (stanza.getChild('delay')) ? true : false;
          if(nick !== 'CG_Bot' && !replay) {
            ircSay(`${nick}: ${message}`);
            processCommand({nick, message, participants, say: async message => {
              ircSay(message);
              await xmppSay({info: message, meeting, xmppClient});
            }});
          }
        }
      }

      // below is attempt to turn off Jingle sessions, may not need it
      // see if someone is attempting to initiate a XMPP jingle session
      // if(stanza.getChild('jingle')) {
      //   console.log('JINGLE SESSION', stanza.toString());
      //   _xmppDenyJingleSession({meeting, xmppClient, stanza});
      // }
    });

    ircClient.on('message' + channel, async (nick, message) => {
      // log IRC messages to logfile if a recording log prefix is specified
      if(ircOptions.log) {
        log({logFile: `${ircOptions.log}-${channel}`, nick, message});
      }

      // echo from IRC to XMPP
      await xmppSay({info: `${nick}: ${message}`, meeting, xmppClient});
      processCommand({nick, message, participants, say: async message => {
        ircSay(message);
        await xmppSay({info: message, meeting, xmppClient});
      }});
    });
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

// below is an attempt to turn off P2P peering -- may not need it
// async function _xmppDenyJingleSession({meeting, xmppClient, stanza}) {
//   const initiator = stanza.getChild('jingle').attrs.initiator;
//
//   console.log("DENY JINGLE SESSION", initiator);
//   let xmppMessage = xml(
//     'iq',
//     {
//       from: xmppClient.jid.toString(),
//       id: uuidv4(),
//       to: initiator,
//       type: 'result'
//     }
//   );
//   await xmppClient.send(message);
//
//   xmppMessage = xml(
//     'iq',
//     {
//       from: xmppClient.jid.toString(),
//       id: uuidv4(),
//       to: initiator,
//       type: 'error'
//     },
//     xml('error', {type: 'cancel'},
//       xml('service-unavailable', 'urn:ietf:params:xml:ns:xmpp-stanzas')
//     )
//   );
//   await xmppClient.send(message);
// }
