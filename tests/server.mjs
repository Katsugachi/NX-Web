// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import { createServer } from '../scripts/serve.mjs';
const server = createServer();
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url = `http://127.0.0.1:${server.address().port}`;
try {
  const page = await fetch(url);
  assert.equal(page.status,200);
  assert.equal(page.headers.get('cross-origin-opener-policy'),'same-origin');
  assert.equal(page.headers.get('cross-origin-embedder-policy'),'require-corp');
  assert.match(await page.text(),/NX-Web/);
  const script = await fetch(`${url}/shell.js`);
  assert.match(script.headers.get('content-type'),/javascript/);
  const head = await fetch(url,{method:'HEAD'}); assert.equal(await head.text(),'');
  assert.equal((await fetch(`${url}/not-a-file`)).status,404);
  assert.equal((await fetch(url,{method:'POST'})).status,405);
  assert.equal((await fetch(`${url}/%E0%A4%A`)).status,404);
  console.log('NX-Web server: isolation headers, assets, HEAD, missing files and invalid requests OK');
} finally { await new Promise(resolve=>server.close(resolve)); }
