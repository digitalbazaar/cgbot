/*!
 * Copyright (c) 2020 Digital Bazaar, Inc. All rights reserved.
 */
import {connect} from './xmpp.js';
import fs from 'fs';
import {promises as fsp} from 'fs';
import {v4 as uuidv4} from 'uuid';
import {spawn} from 'child_process';
import {xml} from '@xmpp/client';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function monitor({xmppOptions, meetings}) {
  const xmppClient = connect(xmppOptions);
  const {debug} = xmppOptions;

  xmppClient.on('stanza', async stanza => {
    const query = stanza.is('iq') ? stanza.getChild('query') : undefined;
    const identity = (query !== undefined) ?
      query.getChild('identity') : undefined;
    const isConference = (identity !== undefined) ?
      identity.attrs.category === 'conference' : false;

    if(isConference) {
      const meeting = identity.attrs.name;

      if(Object.keys(meetings).includes(meeting)) {
        try {
          await fsp.access(
            `/var/tmp/cgbot-manage-${meeting}.lock`, fs.constants.R_OK);
        } catch(e) {
          console.log(`Starting subprocess to manage ${meeting}.`);
          const subprocess = spawn(
            process.argv[0], [process.argv[1], process.argv[2],
              process.argv[3], 'manage', '--meeting', meeting],
            {detached: true, stdio: 'ignore'});
          subprocess.unref();
        }
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
    const xmppMessage = xml(
      'iq',
      {
        from: jid,
        id: uuidv4(),
        to: `${meeting}@conference.${domain}`,
        type: 'get'
      },
      xml('query', {
        xmlns: 'http://jabber.org/protocol/disco#info'
      })
    );

    await xmppClient.send(xmppMessage);
  });
}
