/*!
 * Copyright (c) 2020 Digital Bazaar, Inc. All rights reserved.
 */
const {client} = require('@xmpp/client');
import xmppDebug from '@xmpp/debug';

export function connect({service, domain, username, password, debug}) {
  const xmppClient = client({service, domain, username, password});

  if(debug) {
    xmppDebug(xmppClient, true);
  }

  xmppClient.start().catch(console.error);

  xmppClient.on('error', err => {
    console.error('XMPP Error:', err.toString());
  });

  xmppClient.on('offline', () => {
    if(debug) {
      console.log('XMPP offline.');
    }
  });

  xmppClient.on('stanza', stanza => {
    if(debug) {
      console.log('XMPP stanza:', stanza.toString());
    }
  });

  xmppClient.on('online', address => {
    if(debug) {
      console.log('XMPP online as', address.toString());
    }
  });

  return xmppClient;
}
