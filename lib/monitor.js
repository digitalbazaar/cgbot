/*!
 * Copyright (c) 2020 Digital Bazaar, Inc. All rights reserved.
 */
import {connect} from './xmpp.js';
import {v4 as uuidv4} from 'uuid';
import {xml} from '@xmpp/client';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function monitor({xmppOptions, channels}) {
  const xmpp = connect(xmppOptions);

  xmpp.on('stanza', async stanza => {
    if(stanza.is('iq')) {
      try {
        const error = stanza.getChild('error').getChildText('text');
        console.log(`^^^^^^^${error}^^^^^^^^`);
        if(error === 'You are not currently connected to this chat') {
          const regex = /([a-zA-Z0-9]+)@(.*)/g;
          const channel = [...stanza.attrs.from.matchAll(regex)][0][1];
          console.log('CHANNEL', channel);
          console.log(`MANAGEMENT NEEDED in ${channel}`);
        }
      } catch(e) {
        console.log('MONITOR IGNORING Error', e);
      }
    }
  });

  xmpp.on('online', async address => {
    console.log('MONITOR online as', address.toString());

    while(true) {
      console.log('Monitor polling...');
      await _monitorChannels({xmpp, jid: address, channels, ...xmppOptions});
      await sleep(5000);
    }
  });
}

async function _monitorChannels({xmpp, domain, jid, channels}) {
  Object.keys(channels).forEach(async channel => {
    const message = xml(
      'iq',
      {
        from: jid,
        id: uuidv4(),
        to: `${channel}@conference.${domain}/isActive`,
        type: 'get'
      },
      xml('query', {
        xmlns: 'http://jabber.org/protocol/disco#items'
      })
    );

    await xmpp.send(message);
  });
}
