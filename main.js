/*!
 * Copyright (c) 2020 Digital Bazaar, Inc. All rights reserved.
 */
const {client, xml} = require('@xmpp/client');
import debug from '@xmpp/debug';
import { v4 as uuidv4 } from 'uuid';

/**
 * Monitors the given XMPP server for a set of channels to manage.
 *
 * @param {object} options - The options to use when connecting.
 */
export async function monitor({service, domain, username, password, channels}) {
  const xmpp = client({service, domain, username, password});
  debug(xmpp, true);
  xmpp.start().catch(console.error);

  console.log('cgbot: monitor');

  xmpp.on('error', (err) => {
    console.error('ERR', err.toString());
  });

  xmpp.on('offline', () => {
    console.log('offline');
  });

  xmpp.on('stanza', async (stanza) => {
    console.log('stanza', stanza.toString());
    if(stanza.is('message')) {
      //await xmpp.send(xml('presence', { type: 'unavailable' }));
      //await xmpp.stop();
    } else if(stanza.is('iq')) {
      try {
        const error = stanza.getChild('error').getChildText('text');
        console.log(`^^^^^^^${error}^^^^^^^^`);
        if(error === 'You are not currently connected to this chat') {
          const regex = /([a-zA-Z0-9]+)@(.*)/g;
          const channel = [...stanza.attrs.from.matchAll(regex)][0][1];
          console.log("CHANNEL", channel);
          console.log(`MANAGEMENT NEEDED in ${channel}`);
        }
      } catch(e) {
        console.log("Error", e);
      };
    }
  });

  xmpp.on('online', async (address) => {
    console.log('online as', address.toString());

    while(true) {
      console.log("Monitor polling...");
      await _monitorChannels({xmpp, jid: address, channels});
      await sleep(5000);
    }

  });

}

async function _monitorChannels({xmpp, jid, channels}) {
  channels.forEach(async channel => {
    const message = xml(
      'iq',
      {
        from: jid,
        id: uuidv4(),
        to: `${channel}@conference.meet.w3c-ccg.org/isActive`,
        type: 'get'
      },
      xml('query', {
        xmlns: 'http://jabber.org/protocol/disco#items'
      })
    );

    await xmpp.send(message);
  });
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
