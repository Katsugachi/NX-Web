// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const report = process.env.AUDIO_REPORT || join(homedir(), 'nx-web-audio-renderer-report.json');
const result = spawnSync(process.execPath, [fileURLToPath(new URL('./audio_browser.mjs', import.meta.url))], {
  stdio: 'inherit',
  env: {
    ...process.env,
    ROM_PATH: process.env.ROM_PATH || fileURLToPath(new URL('./fixtures/audio-renderer/audio-renderer.nro', import.meta.url)),
    AUDIO_REPORT: report,
    AUDIO_SECONDS: process.env.AUDIO_SECONDS || '40',
    AUDIO_KEY: '',
  },
});
assert.equal(result.status, 0, 'AudioRenderer PCM probe failed');
const { timeline } = JSON.parse(await readFile(report, 'utf8'));
for (const stage of ['empty', 'result']) {
  const line = timeline.find(entry => entry.text.includes(`AUDIO_RENDERER ${stage} `))?.text;
  assert.ok(line, `missing AudioRenderer ${stage} result`);
  assert.match(line, /\bfailures=0\b/, line);
}
console.log('AudioRenderer observation: empty queue, delayed client, and PCM passed.');
