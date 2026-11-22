// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import { createServer } from '../scripts/serve.mjs';

assert.ok(process.env.ROM_PATH, 'Set ROM_PATH to an audio-producing homebrew NRO or bundled ZIP');
const seconds = Number(process.env.AUDIO_SECONDS || 60);
assert.ok(Number.isFinite(seconds) && seconds > 0 && seconds <= 300, 'AUDIO_SECONDS must be in (0, 300]');
const server = createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
let context;
try {
  browser = await puppeteer.connect({ browserURL: process.env.CDP_URL || 'http://localhost:9227' });
  context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.evaluateOnNewDocument(() => {
    window.__audioProbe = { callbacks: 0, nonzero: 0, samples: 0, sumSquares: 0, peak: 0 };
    const AudioContext = window.AudioContext;
    window.AudioContext = class extends AudioContext {
      createScriptProcessor(...args) {
        const node = super.createScriptProcessor(...args);
        let callback;
        Object.defineProperty(node, 'onaudioprocess', {
          get: () => callback,
          set: value => { callback = value; },
        });
        node.addEventListener('audioprocess', event => {
          callback?.call(node, event);
          const stats = window.__audioProbe;
          stats.callbacks++;
          for (let channel = 0; channel < event.outputBuffer.numberOfChannels; channel++) {
            for (const value of event.outputBuffer.getChannelData(channel)) {
              stats.samples++;
              stats.sumSquares += value * value;
              stats.peak = Math.max(stats.peak, Math.abs(value));
              if (value !== 0) stats.nonzero++;
            }
          }
        });
        return node;
      }
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => document.querySelector('#wasm-status-text').textContent === 'WASM Core Ready', { timeout: 120_000 });
  await (await page.$('#file-input')).uploadFile(process.env.ROM_PATH);
  const start = Date.now();
  const key = process.env.AUDIO_KEY ?? 'l';
  if (key) {
    await new Promise(resolve => setTimeout(resolve, Math.min(5000, seconds * 500)));
    await page.bringToFront();
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.down(key);
    await new Promise(resolve => setTimeout(resolve, 500));
    await page.keyboard.up(key);
  }
  await new Promise(resolve => setTimeout(resolve, Math.max(0, seconds * 1000 - (Date.now() - start))));
  const stats = await page.evaluate(() => window.__audioProbe);
  const rms = stats.samples ? Math.sqrt(stats.sumSquares / stats.samples) : 0;
  console.log(`Audio browser (${seconds}s): callbacks=${stats.callbacks} nonzero=${stats.nonzero} samples=${stats.samples} RMS=${rms} peak=${stats.peak}`);
  assert.ok(stats.callbacks > 0, 'no Web Audio callbacks');
  assert.ok(stats.nonzero > 0 && Number.isFinite(rms) && rms > 0, 'output PCM is silent or invalid');
} finally {
  await context?.close();
  await browser?.disconnect();
  await new Promise(resolve => server.close(resolve));
}
