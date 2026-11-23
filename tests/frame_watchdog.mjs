// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createFrameWatchdog, createBootWatchdog, bootTimeoutMs } from '../web/frame-watchdog.js';

for (const value of [null, '', 'bad', 'Infinity', '-1', '0']) assert.equal(bootTimeoutMs(value), 90_000);
assert.equal(bootTimeoutMs('15'), 15);
let bootTime = 0;
const stalls = [];
const bootWatch = createBootWatchdog({ timeoutMs: 100, now: () => bootTime, onStall: file => stalls.push(file) });
bootWatch.tick();
assert.deepEqual(stalls, []);
bootWatch.start('first');
bootTime = 90;
bootWatch.progress();
bootTime = 180;
bootWatch.tick();
assert.deepEqual(stalls, [], 'engine output or copying progress extends the boot deadline');
bootTime = 190;
bootWatch.tick();
bootWatch.tick();
assert.deepEqual(stalls, ['first'], 'a stalled boot is reported once');
bootWatch.start('next');
bootWatch.stop();
bootTime = 500;
bootWatch.tick();
assert.deepEqual(stalls, ['first'], 'stopping the boot watchdog cancels the deadline');

const appSource = await readFile(new URL('../web/app.js', import.meta.url), 'utf8');
const pollStart = appSource.slice(appSource.indexOf('function pollStatus()'), appSource.indexOf('  const runtimeStats = showRuntimeInfo(state);'));
for (const state of [0, 1, 2]) {
  const observed = [];
  const boot = createBootWatchdog({ timeoutMs: 100, now: () => bootTime, onStall: file => observed.push(file) });
  boot.start('no-frames');
  runInNewContext(`${pollStart}}; pollStatus();`, {
    edenModule: { _eden_get_state: () => state, _eden_get_game_fps: () => 0 },
    crashed: false, memoryUnavailable: false, bootStalled: false, bootWatchdog: boot,
  });
  bootTime += 101;
  boot.tick();
  assert.deepEqual(observed, state === 2 ? [] : ['no-frames'], 'Running cancels boot detection even with zero FPS; pre-Running remains covered');
}

let time = 0;
const freezes = [];
let first = 0;
const watch = createFrameWatchdog({ timeoutMs: 45_000, now: () => time,
  onFirstFrame: () => first++, onFreeze: text => freezes.push(text) });
watch(2, 0, 0);
time = 60_000;
watch(2, 0, 0);
assert.equal(freezes.length, 0, 'Running without a first frame does not count as a freeze');
watch(2, 60, 1);
assert.equal(first, 1);
time += 46_000;
watch(2, 60, 1);
assert.equal(freezes.length, 1, 'stale positive FPS cannot hide a stopped frame counter');
watch(2, 60, 1);
assert.equal(freezes.length, 1, 'a freeze is reported once');
watch(2, 60, 2);
time += 1000;
watch(3, 60, 2);
time += 120_000;
watch(3, 60, 2);
watch(2, 0, 2);
assert.equal(freezes.length, 1, 'a long pause does not cause a freeze on resume');
time += 1000;
watch(2, 0, 3);
assert.equal(freezes.length, 1, 'new frame counters indicate progress even if averaged FPS is zero');
assert.equal(first, 1);
const legacy = createFrameWatchdog({ timeoutMs: 10, now: () => time, onFreeze: text => freezes.push(text) });
legacy(2, 1);
time += 11;
legacy(2, 0);
assert.equal(freezes.length, 2, 'legacy runtimes fall back to FPS');
console.log('Frame watchdog: stale FPS, long pause, first frame and legacy runtime OK');
