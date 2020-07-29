/*!
 * Copyright (c) 2020 Digital Bazaar, Inc. All rights reserved.
 */
import {promises as fs} from 'fs';

export async function log({logFile, nick, message}) {
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const ircLog = `${logFile}-${date}-irc.log`;
  const logLine = '[' + new Date().toISOString() + ']\t<' + nick + '>\t' +
    message + '\n';

  console.log(logFile, nick, message);
  // log, ignoring all errors
  await fs.appendFile(ircLog, logLine);
}
