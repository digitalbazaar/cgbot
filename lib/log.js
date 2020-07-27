/*!
 * Copyright (c) 2020 Digital Bazaar, Inc. All rights reserved.
 */
import {promises as fs} from 'fs';
import path from 'path';

/**
 * Logs a message to the chat log.
 *
 * @param {object} options - The options to use when connecting.
 */
export async function log({logFile, nick, message}) {
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const ircLog = path.join(logFile, date + '-irc.log');
  const logLine = '[' + new Date().toISOString() + ']\t<' + nick + '>\t' +
    message + '\n';

  // log, ignoring all errors
  await fs.appendFile(ircLog, logLine);
}
