/*!
 * Copyright (c) 2020 Digital Bazaar, Inc. All rights reserved.
 */
import {connect as xmppConnect} from './xmpp.js';
import {connect as ircConnect} from './irc.js';
import {v4 as uuidv4} from 'uuid';
import {xml} from '@xmpp/client';

/**
 * Monitors a given XMPP server.
 *
 * @param {object} options - The options to use when connecting.
 */
export async function manage({xmppOptions, ircOptions}) {
  const xmpp = xmppConnect(xmppOptions);
  //const irc = ircConnect({service, domain, username, password});

  xmpp.on('stanza', async stanza => {
    console.log('XMPP MANAGE', stanza.toString());
  });

  xmpp.on('online', async address => {
    console.log('XMPP MANAGE online as', address.toString());
  });
}
