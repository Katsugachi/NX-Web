// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import { createServer } from '../scripts/serve.mjs';

assert.ok(process.env.ROM_PATH, 'Set ROM_PATH to the libnx hello-world template NRO');
const server = createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await puppeteer.connect({ browserURL: process.env.CDP_URL || 'http://localhost:9227' });
  for (const mode of ['default', 'remapped', 'reset']) {
    const context = await browser.createBrowserContext();
    try {
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.waitForSelector('#cpu-core option');
      if (mode !== 'default') {
        await page.click('#library-settings');
        await page.click('[data-binding="plus"]');
        await page.keyboard.press('v');
        if (mode === 'reset') await page.click('#reset-bindings');
        await page.click('#close-settings');
      }
      const input = await page.$('#file-input');
      await input.uploadFile(process.env.ROM_PATH);
      await page.waitForFunction(() => document.querySelector('#wasm-state').textContent === 'Running'
        && parseFloat(document.querySelector('#fps-counter').textContent) > 5, { timeout: 60000 });
      await page.focus('#canvas');
      const key = mode === 'remapped' ? 'v' : 'Enter';
      await page.keyboard.down(key);
      try {
        await page.waitForFunction(() => document.querySelector('#wasm-state').textContent === 'Stopped', { timeout: 15000 });
      } finally { await page.keyboard.up(key); }
      console.log(`Keyboard browser: ${mode} Plus (${key}) exits hello-world: Stopped`);
    } finally { await context.close(); }
  }
} finally {
  await browser?.disconnect();
  await new Promise(resolve => server.close(resolve));
}
