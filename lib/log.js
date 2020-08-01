/*!
 * Copyright (c) 2020 Digital Bazaar, Inc. All rights reserved.
 */
import {promises as fs} from 'fs';

export function getLogUrl({logFileBasePath, logUrl}) {
  const logFilePath = _getLogFilename({logFileBasePath});
  const logFilename = logFilePath.split('/').pop();
  return logUrl + logFilename;
}

export async function log({logFileBasePath, nick, message}) {
  const logFilePath = _getLogFilename({logFileBasePath});
  const logLine = '[' + new Date().toISOString() + ']\t<' + nick + '>\t' +
    message + '\n';

  // log, ignoring all errors
  await fs.appendFile(logFilePath, logLine);
}

function _getLogFilename({logFileBasePath}) {
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const logFilePath = `${logFileBasePath}-${date}-irc.log`;

  return logFilePath;
}
