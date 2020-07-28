import irc from 'irc';

export function connect(
  {server, port, channel, nick, servpass, chanpass}) {
  channel = (chanpass) ? `${channel} ${chanpass}` : channel;

  // connect to the IRC channel
  const ircOptions = {
    userName: nick,
    realName: `Digital Bazaar W3C CG Bot (${nick})`,
    port: parseInt(port, 10),
    channels: [channel]
  };

  // check if TLS should be used to connect
  if(port === '6697') {
    ircOptions.secure = true;
    ircOptions.selfSigned = true;
  }

  // check to see if the server requires a password
  if(servpass) {
    ircOptions.password = servpass;
  }

  const ircClient = new irc.Client(server, nick, ircOptions);

  // hook up an error handler to prevent exit on error
  ircClient.on('error', function(message) {
    console.log('IRC Error: ', message);
  });

  return ircClient;
}
