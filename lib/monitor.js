/*!
 * Copyright (c) 2020 Digital Bazaar, Inc. All rights reserved.
 */
import {connect} from './xmpp.js';
import {v4 as uuidv4} from 'uuid';
import {xml} from '@xmpp/client';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function monitor({xmppOptions, channels}) {
  const xmpp = connect(xmppOptions);
  const {debug} = xmppOptions;

  xmpp.on('stanza', async stanza => {
    if(stanza.is('iq')) {
      const error = stanza.getChild('error');
      if(error && error.getChildText('text') ===
        'You are not currently connected to this chat') {
        const regex = /([a-zA-Z0-9]+)@(.*)/g;
        const channel = [...stanza.attrs.from.matchAll(regex)][0][1];
        console.log('CHANNEL', channel);
        console.log(`MANAGEMENT NEEDED in ${channel}`);
      }
    }
  });

  xmpp.on('online', async address => {
    while(true) {
      if(debug) {
        console.log('XMPP polling channels:', Object.keys(channels));
      }
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
