/*!
 * Copyright (c) 2020 Digital Bazaar, Inc. All rights reserved.
 */
const {client} = require('@xmpp/client');
import xmppDebug from '@xmpp/debug';

export function connect({service, domain, username, password, debug}) {
  const xmpp = client({service, domain, username, password});

  if(debug) {
    xmppDebug(xmpp, true);
  }

  xmpp.start().catch(console.error);

  xmpp.on('error', err => {
    console.error('XMPP Error:', err.toString());
  });

  xmpp.on('offline', () => {
    if(debug) {
      console.log('XMPP offline.');
    }
  });

  xmpp.on('stanza', stanza => {
    if(debug) {
      console.log('XMPP stanza:', stanza.toString());
    }
  });

  xmpp.on('online', address => {
    if(debug) {
      console.log('XMPP online as', address.toString());
    }
  });

  return xmpp;
}
