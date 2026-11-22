// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { playerFps, rebootGame, createPipCapture } from '../web/player-session.js';

assert.equal(playerFps(2, 39.96), '40.0 FPS');
assert.equal(playerFps(2, NaN), '0.0 FPS');
assert.equal(playerFps(3, 40), 'Paused');
for (const state of [0, 1, 4, 5]) assert.equal(playerFps(state, 40), '--');

const file = { name: 'hello.nro' };
const calls = [];
const actions = Object.fromEntries(['stash', 'preserve', 'mark', 'shutdown', 'reload'].map(name => [name, asyncFile => {
  calls.push(name);
  if (name === 'stash' || name === 'mark') assert.equal(asyncFile, file);
}]));
await rebootGame(file, actions);
assert.deepEqual(calls, ['stash', 'preserve', 'mark', 'shutdown', 'reload']);
calls.length = 0;
await assert.rejects(rebootGame(null, actions), /No game/);
assert.deepEqual(calls, []);
for (const failed of ['stash', 'preserve', 'mark']) {
  calls.length = 0;
  await assert.rejects(rebootGame(file, { ...actions, [failed]: () => { throw new Error('storage blocked'); } }), /storage blocked/);
  assert.ok(!calls.includes('shutdown') && !calls.includes('reload'), 'storage failure leaves the running game intact');
}
calls.length = 0;
await assert.rejects(rebootGame(file, { ...actions, stash: async () => { throw new Error('quota exceeded'); } }), /quota exceeded/);
assert.deepEqual(calls, []);

const appSource = await readFile(new URL('../web/app.js', import.meta.url), 'utf8');
const stashSource = appSource.slice(appSource.indexOf('async function stashGameFile('), appSource.indexOf('\nfunction showSavePoint('));
let generation = 0;
let writes = 0;
let resumedFile;
let storedBlob = new Blob(['original ROM']);
const handle = {
  async getFile() {
    const version = generation;
    const blob = storedBlob;
    return {
      name: 'hello.nro', size: blob.size,
      stream: () => blob.stream(),
      arrayBuffer: async () => {
        if (version !== generation) throw new Error('OPFS snapshot invalidated');
        return blob.arrayBuffer();
      },
    };
  },
  async createWritable() {
    writes++;
    const chunks = [];
    return new WritableStream({ write: chunk => chunks.push(chunk), close: () => { storedBlob = new Blob(chunks); generation++; } });
  },
};
const stash = runInNewContext(`${stashSource}; ({ stashGameFile, resumeAfterCrash });`, {
  resumedGameFile: null, resume: { name: 'hello.nro', reset: true },
  resumeDir: async () => ({ getFileHandle: async () => handle }),
  handleFile: async file => { resumedFile = file; }, log() {}, setRomStatus(message) { assert.fail(message); },
});
await stash.resumeAfterCrash();
for (const failed of ['preserve', 'mark']) {
  await assert.rejects(rebootGame(resumedFile, {
    ...actions, stash: file => stash.stashGameFile(file, true),
    [failed]: () => { throw new Error('storage blocked'); },
  }), /storage blocked/);
  assert.equal(writes, 0, 'a failed reset must not replace the active OPFS ROM');
  assert.equal(new TextDecoder().decode(await resumedFile.arrayBuffer()), 'original ROM');
}
await stash.stashGameFile(resumedFile, true);
assert.equal(writes, 0, 'reset can retry without rewriting the resumed ROM');
await stash.stashGameFile(new File(['different ROM'], 'hello.nro'), true);
assert.equal(writes, 1, 'a different file with the same name must still replace the stash');
assert.equal(await storedBlob.text(), 'different ROM');

let captures = 0;
let stops = 0;
const stream = { getTracks: () => [{ stop: () => stops++ }] };
const canvas = { captureStream: fps => { assert.equal(fps, 60); captures++; return stream; } };
const video = { srcObject: null, play: async () => {} };
const pip = createPipCapture(canvas, video);
assert.equal(captures, 0, 'no capture before a request');
pip.stop();
assert.equal(stops, 0, 'stopping an empty capture is harmless');
await pip.start();
assert.equal(captures, 1);
assert.equal(video.srcObject, stream);
pip.stop();
assert.equal(stops, 1);
assert.equal(video.srcObject, null);
await pip.start();
pip.stop();
assert.equal(captures, 2, 'a later PiP request gets a fresh stream');
video.play = async () => { throw new Error('play failed'); };
await assert.rejects(pip.start(), /play failed/);
assert.equal(video.srcObject, null);
assert.equal(stops, 3, 'failed playback releases tracks');
video.play = () => new Promise(() => {});
await assert.rejects(createPipCapture(canvas, video, 1).start(), /No video frame/);
assert.equal(video.srcObject, null);
const pending = pip.start();
pip.stop();
await assert.rejects(pending, /cancelled/);
assert.equal(video.srcObject, null);
await assert.rejects(createPipCapture({ captureStream: () => { throw new Error('capture failed'); } }, video).start(), /capture failed/);
console.log('Player session: active/paused/stopped FPS, reset ordering/storage errors, lazy PiP capture/cleanup/retry OK');
