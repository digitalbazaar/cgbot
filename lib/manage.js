/*!
 * Copyright (c) 2020 Digital Bazaar, Inc. All rights reserved.
 */
import {connect as xmppConnect} from './xmpp.js';
import {connect as ircConnect} from './irc.js';
import {processMessage} from './message.js';
import {v4 as uuidv4} from 'uuid';
import {xml} from '@xmpp/client';

export async function manage({meeting, xmppOptions, meetings}) {
  const xmppClient = xmppConnect(xmppOptions);
  const {ircOptions} = meetings[meeting];
  const ircClient = ircConnect(ircOptions);

  xmppClient.on('stanza', async stanza => {
    if(xmppOptions.debug) {
      console.log('XMPP MANAGE', stanza.toString());
    }
  });

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
    ircClient.on('message' + channel, (nick, message) => {
      console.log(nick, message);
      processMessage({nick, message, say: async message => {
        ircSay(message);
        await xmppSay({info: message, meeting, xmppClient});
      }});
      // log IRC messages to logfile if a recording directory is specified
      // if(log) {
      //   logMessage({logFile: `${log}-${channel}`, nick, message});
      // }
    });
  });
}

async function _joinXmppMuc({meeting, xmppClient}) {
  const message = xml(
    'presence',
    {
      from: xmppClient.jid.toString(),
      id: uuidv4(),
      to: `${meeting}@conference.${xmppClient.jid._domain}/cgbot`
    },
    xml('nick', {
      xmlns: 'http://jitsi.org/jitmeet/audio'
    }, 'CG Bot'),
    xml('x', {
      xmlns: 'http://jabber.org/protocol/muc'
    })
  );

  await xmppClient.send(message);
}

async function xmppSay({info, meeting, xmppClient}) {
  const message = xml(
    'message',
    {
      from: xmppClient.jid.toString(),
      id: uuidv4(),
      to: `${meeting}@conference.${xmppClient.jid._domain}/cgbot`,
      type: 'groupchat'
    },
    xml('nick', {
      xmlns: 'http://jabber.org/protocol/nick'
    }, 'CG Bot'),
    xml('body', {}, info)
  );

  await xmppClient.send(message);
}
