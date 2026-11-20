if (process.argv[2] === '--local') {
  const workspace = process.argv[3];
  if (!workspace) {
    console.error('Usage: pnpm start:local <checkout-path>');
    process.exitCode = 1;
  } else {
    const { startLocalServer } = require('./localServer');
    startLocalServer(workspace)
      .then(server => console.log(`Quartorium local editor API listening on http://127.0.0.1:${server.address().port}`))
      .catch(error => {
        console.error(`Could not start the local editor API. ${error.message}`);
        process.exitCode = 1;
      });
  }
} else {
  require('./collaborationServer');
}
