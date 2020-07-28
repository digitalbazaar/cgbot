/*!
 * Copyright (c) 2020 Digital Bazaar, Inc. All rights reserved.
 */
import {connect as xmppConnect} from './xmpp.js';
import {connect as ircConnect} from './irc.js';
import {v4 as uuidv4} from 'uuid';
import {xml} from '@xmpp/client';

export async function manage({meeting, xmppOptions, meetings}) {
  const xmpp = xmppConnect(xmppOptions);
  const ircOptions = meetings[meeting];
  const irc = false;
  //const irc = ircConnect(ircOptions);

  xmpp.on('stanza', async stanza => {
    console.log('XMPP MANAGE', stanza.toString());
  });

  xmpp.on('online', async address => {
    console.log('XMPP MANAGE online as', address.toString());
    await _joinXmppMuc({meeting, xmpp});
  });
}

async function _joinXmppMuc({meeting, xmpp}) {
  const message = xml(
    'presence',
    {
      from: xmpp.jid.toString(),
      id: uuidv4(),
      to: `${meeting}@conference.${xmpp.jid._domain}/OOPS`,
      //type: 'unavailable'
    },
    // xml('videomuted', {
    //   xmlns: 'http://jitsi.org/jitmeet/video'
    // }, true),
    // xml('audiomuted', {
    //   xmlns: 'http://jitsi.org/jitmeet/audio'
    // }, true),
    xml('nick', {
      xmlns: 'http://jitsi.org/jitmeet/audio'
    }, 'CG Bot'),
    xml('x', {
      xmlns: 'http://jabber.org/protocol/muc'
    })
  );

  console.log("JOINMUC", message.toString());

  await xmpp.send(message);


}
