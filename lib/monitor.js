/*!
 * Copyright (c) 2020 Digital Bazaar, Inc. All rights reserved.
 */
import {connect} from './xmpp.js';
import {v4 as uuidv4} from 'uuid';
import {xml} from '@xmpp/client';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function monitor({xmppOptions, meetings}) {
  const xmpp = connect(xmppOptions);
  const {debug} = xmppOptions;

  xmpp.on('stanza', async stanza => {
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

  xmpp.on('online', async address => {
    while(true) {
      if(debug) {
        console.log('XMPP polling meetings:', Object.keys(meetings));
      }
      await _monitorMeetings({xmpp, jid: address, meetings, ...xmppOptions});
      await sleep(5000);
    }
  });
}

async function _monitorMeetings({xmpp, domain, jid, meetings}) {
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

    await xmpp.send(message);
  });
}
