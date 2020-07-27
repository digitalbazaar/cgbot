/*!
 * Copyright (c) 2020 Digital Bazaar, Inc. All rights reserved.
 */
const {client} = require('@xmpp/client');
import debug from '@xmpp/debug';

/**
 * Connects to the given XMPP server.
 *
 * @param {object} options - The options to use when connecting.
 */
export function connect({service, domain, username, password}) {
  const xmpp = client({service, domain, username, password});
  debug(xmpp, true);
  xmpp.start().catch(console.error);

  xmpp.on('error', err => {
    console.error('ERR', err.toString());
  });

  xmpp.on('offline', () => {
    console.log('offline');
  });

  xmpp.on('stanza', stanza => {
    console.log('stanza', stanza.toString());
  });

  xmpp.on('online', address => {
    console.log('online as', address.toString());
  });

  return xmpp;
}
