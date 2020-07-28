/*!
 * Copyright (c) 2020 Digital Bazaar, Inc. All rights reserved.
 */
import {client} from '@xmpp/client';
import xmppDebug from '@xmpp/debug';

export function connect({service, domain, username, password, debug}) {
  const xmppClient = client({service, domain, username, password});

  // Only used for debugging XMPP client bugs, usually commented out
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

  xmppClient.on('online', address => {
    if(debug) {
      console.log('XMPP online as', address.toString());
    }
  });

  return xmppClient;
}
