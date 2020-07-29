/*!
 * Copyright (c) 2020 Digital Bazaar, Inc. All rights reserved.
 */
import {connect} from './xmpp.js';
import {v4 as uuidv4} from 'uuid';
import {xml} from '@xmpp/client';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function monitor({xmppOptions, meetings}) {
  const xmppClient = connect(xmppOptions);
  const {debug} = xmppOptions;

  xmppClient.on('stanza', async stanza => {
    if(stanza.is('iq')) {
      const error = stanza.getChild('error');
      if(error && error.getChildText('text') ===
        'You are not currently connected to this chat') {
        const regex = /([a-zA-Z0-9]+)@(.*)/g;
        const meeting = [...stanza.attrs.from.matchAll(regex)][0][1];
        console.log('MEETING', meeting);
        console.log(`MANAGEMENT NEEDED in ${meeting}`);
      }
    }
  });

  xmppClient.on('online', async address => {
    while(true) {
      if(debug) {
        console.log('XMPP polling meetings:', Object.keys(meetings));
      }
      await _monitorMeetings(
        {xmppClient, jid: address, meetings, ...xmppOptions});
      await sleep(5000);
    }
  });

  // start the XMPP client once all handlers are setup
  xmppClient.start().catch(console.error);
}

async function _monitorMeetings({xmppClient, domain, jid, meetings}) {
  Object.keys(meetings).forEach(async meeting => {
    const message = xml(
      'iq',
      {
        from: jid,
        id: uuidv4(),
        to: `${meeting}@conference.${domain}/isActive`,
        type: 'get'
      },
      xml('query', {
        xmlns: 'http://jabber.org/protocol/disco#items'
      })
    );

    await xmppClient.send(message);
  });
}
