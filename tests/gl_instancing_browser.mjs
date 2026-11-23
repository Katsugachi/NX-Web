// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { createServer } from '../scripts/serve.mjs';

assert.ok(process.env.ROM_PATH, 'Set ROM_PATH to the gl-instancing fixture NRO');
const seconds = Number(process.env.GL_SECONDS || 25);
assert.ok(Number.isFinite(seconds) && seconds >= 5 && seconds <= 120, 'GL_SECONDS must be in [5, 120]');
const server = createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser, context;
try {
  browser = await puppeteer.connect({ browserURL: process.env.CDP_URL || 'http://localhost:9227' });
  context = await browser.createBrowserContext();
  const page = await context.newPage();
  const logs = [];
  page.on('console', message => logs.push(message.text()));
  if (process.env.GL_RUNTIME_DIR) {
    await page.setRequestInterception(true);
    page.on('request', async request => {
      const name = path.posix.basename(new URL(request.url()).pathname);
      if (name !== 'eden.js' && name !== 'eden.wasm') return request.continue();
      try {
        await request.respond({ status: 200,
          contentType: name.endsWith('.js') ? 'application/javascript' : 'application/wasm',
          headers: { 'Cross-Origin-Resource-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Opener-Policy': 'same-origin' },
          body: await readFile(path.join(process.env.GL_RUNTIME_DIR, name)) });
      } catch (error) {
        logs.push(String(error));
        await request.abort();
      }
    });
  }
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => document.querySelector('#wasm-status-text').textContent === 'WASM Core Ready', { timeout: 120_000 })
    .catch(error => { throw new Error(`${error.message}\n${logs.slice(-12).join('\n')}`); });
  await (await page.$('#file-input')).uploadFile(process.env.ROM_PATH);
  await new Promise(resolve => setTimeout(resolve, seconds * 1000));
  if (process.env.GL_LOG) await writeFile(process.env.GL_LOG, logs.join('\n'));
  assert.ok(!logs.some(line => line.includes('GL_INSTANCING failure:')), logs.filter(line => line.includes('GL_INSTANCING')).join('\n'));
  assert.ok(logs.some(line => line.includes('GL_INSTANCING ready errors=0')), 'fixture did not reach its GL error check');
  const canvas = await page.$('canvas');
  const png = await canvas.screenshot();
  if (process.env.GL_SCREENSHOT) await writeFile(process.env.GL_SCREENSHOT, png);
  const components = await page.evaluate(async data => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = new OffscreenCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const { data: pixels, width, height } = ctx.getImageData(0, 0, image.width, image.height);
    const labels = new Uint8Array(width * height);
    for (let i = 0; i < labels.length; i++) {
      const [r, g, b] = pixels.subarray(i * 4, i * 4 + 3);
      labels[i] = r > 180 && g < 60 && b < 60 ? 1 :
        g > 180 && r < 60 && b < 60 ? 2 : b > 180 && r < 60 && g < 60 ? 3 : 0;
    }
    const components = [];
    for (let i = 0; i < labels.length; i++) {
      const color = labels[i];
      if (!color) continue;
      const pending = [i];
      labels[i] = 0;
      let area = 0, x = 0, y = 0;
      while (pending.length) {
        const p = pending.pop(), px = p % width, py = Math.floor(p / width);
        area++; x += px; y += py;
        for (const n of [px ? p - 1 : -1, px + 1 < width ? p + 1 : -1, p - width, p + width]) {
          if (n >= 0 && n < labels.length && labels[n] === color) {
            labels[n] = 0;
            pending.push(n);
          }
        }
      }
      if (area >= 30) components.push({ color, area, x: x / area, y: y / area });
    }
    return components;
  }, Buffer.from(png).toString('base64'));
  components.sort((a, b) => a.y - b.y);
  console.log(`GL instancing: ${components.length} colored quads; counts=${[1, 2, 3].map(color => components.filter(c => c.color === color).length).join(',')}`);
  assert.equal(components.length, 9, 'expected nine quads and no zero-instance output');
  const rows = [0, 3, 6].map(start => components.slice(start, start + 3).sort((a, b) => a.x - b.x));
  for (const row of rows) assert.deepEqual(row.map(c => c.color), [1, 2, 3], 'gl_InstanceID colors must remain RGB with nonzero base instance');
  const step = rows[0][1].x - rows[0][0].x;
  assert.ok(Math.abs(rows[1][0].x - rows[0][0].x - step) < 5, 'base-instance vertex fetch must advance one element');
  console.log('GL instancing: arrays, nonzero base instance, indexed, empty draw, and FBO switch passed.');
} finally {
  await context?.close();
  await browser?.disconnect();
  await new Promise(resolve => server.close(resolve));
}
