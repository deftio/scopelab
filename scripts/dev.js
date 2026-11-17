#!/usr/bin/env node
/*
 * npm run dev -- serve public/ with bitwrench's own `bwcli serve`.
 *
 * Uses the same port as `npm start` (package.json "config.port", or PORT),
 * checks it is free first, and prints the URL once bwcli is up.
 * bwcli also opens a second "input" port for protocol messages (port + 1);
 * this app doesn't use it, but it has to be free too.
 */
'use strict';

const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const PORT = parseInt(process.env.PORT || process.env.npm_package_config_port || '8642', 10);
const INPUT_PORT = PORT + 1;
const ROOT = path.join(__dirname, '..');
const BWCLI = path.join(ROOT, 'node_modules', 'bitwrench', 'bin', 'bwcli.js');

function checkFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '127.0.0.1');
  });
}

(async () => {
  for (const p of [PORT, INPUT_PORT]) {
    if (!(await checkFree(p))) {
      console.error('\n  Port ' + p + ' is already in use by another program.');
      console.error('  Pick another one, e.g.:  PORT=' + (PORT + 10) + ' npm run dev\n');
      process.exit(1);
    }
  }

  const child = spawn(process.execPath, [
    BWCLI, 'serve', path.join(ROOT, 'public'),
    '--port', String(PORT), '--listen', String(INPUT_PORT),
    '--bind', '127.0.0.1', '--no-dir-list'
  ], { stdio: ['inherit', 'inherit', 'pipe'] });

  let announced = false;
  child.stderr.on('data', (chunk) => {
    process.stderr.write(chunk);
    if (!announced && /Ready/.test(String(chunk))) {
      announced = true;
      console.log('');
      console.log('  ScopeLab (bwcli serve)');
      console.log('  Running on port ' + PORT + ':  http://localhost:' + PORT);
      console.log('  Captures stay in the browser (use npm start to also save them to disk).');
      console.log('  Press Ctrl+C to stop.');
      console.log('');
    }
  });
  child.on('exit', (code) => process.exit(code == null ? 1 : code));
  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
})();
