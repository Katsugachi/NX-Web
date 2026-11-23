// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import { setupInput } from '../web/input.js';
import { DEFAULT_BINDINGS, parseBindings, rebind } from '../web/bindings.js';

let now = 10;
let frame;
let modal = false;
let pads = [];
globalThis.window = new EventTarget();
globalThis.document = Object.assign(new EventTarget(), {
  hidden:false,
  querySelector:selector => selector === 'dialog[open]' && modal ? {} : null,
});
globalThis.performance = { now:() => now };
globalThis.localStorage = { getItem:() => null };
globalThis.requestAnimationFrame = callback => { frame = callback; };
Object.defineProperty(globalThis, 'navigator', { value:{ getGamepads:() => pads } });

const sent = new Map();
const connected = [];
const motion = (player, dt, ...values) => sent.set(player, { dt, values });
let engine = {
  _eden_set_button() {},
  _eden_set_stick() {},
  _eden_set_motion: motion,
  _eden_set_player_connected:player => connected.push(player),
};
const controls = setupInput(() => engine);
const tick = (elapsed = 17) => {
  now += elapsed;
  const callback = frame;
  frame = null;
  callback?.();
};
function event(type, fields = {}) {
  window.dispatchEvent(Object.assign(new Event(type, { cancelable:true }), fields));
}
function key(code, pressed = true) { event(pressed ? 'keydown' : 'keyup', { code }); }
const compare = (actual, expected) => assert.ok(actual.every((value, i) =>
  Math.abs(value - expected[i]) < 1e-6), JSON.stringify({ actual, expected }));
const rest = [0, 0, 0, 0, 0, -1];
const check = (values, player = 0) => compare(sent.get(player).values, values);
const xyz = (x, y, z) => ({ x, y, z });
const gravity = 9.80665;

assert.equal(sent.size, 0);
key('Digit1');
check([0.5, 0, 0, 0, -0.5, -Math.sqrt(0.75)]);
assert.equal(sent.get(0).dt, 0);
tick();
assert.equal(sent.get(0).dt, 17_000, 'sensor delta uses elapsed microseconds');
key('Digit1', false);
tick();
check(rest);
tick();
assert.equal(sent.get(0).dt, 17_000, 'continuous neutral samples let the guest level its orientation');

const migrated = parseBindings('{"a":"Digit1","b":"KeyV"}');
assert.equal(migrated.a, 'Digit1');
assert.equal(migrated.b, 'KeyV');
assert.equal(migrated.pitchUp, null, 'new default does not evict an existing binding');
const bindings = rebind(DEFAULT_BINDINGS, 'pitchUp', 'KeyM');
window.dispatchEvent(new CustomEvent('nx-bindings', { detail:bindings }));
key('KeyM');
tick();
check([0.5, 0, 0, 0, -0.5, -Math.sqrt(0.75)]);
event('blur');
check(rest);
tick();

event('devicemotion', {
  rotationRate:{ beta:180, gamma:-90, alpha:36 },
  accelerationIncludingGravity:xyz(gravity, 0, gravity / 2),
});
tick();
check([0.5, -0.25, 0.1, -1, 0, -0.5]);
tick(300);
check(rest);
event('devicemotion', { rotationRate:{ beta:null, gamma:NaN, alpha:0 } });
tick();
check(rest);

event('deviceorientation', { alpha:359, beta:0, gamma:0 });
tick();
check(rest);
now += 3;
event('deviceorientation', { alpha:0, beta:0, gamma:0 });
tick();
check([0, 0, 1 / 360 / 0.020, 0, 0, -1]);
tick(100);
check(rest);
event('deviceorientation', { alpha:0, beta:90, gamma:0 });
tick(100);
check([0, 0, 0, 0, -1, 0]);
event('devicemotion', { acceleration:xyz(gravity / 2, 0, 0) });
tick();
check([0, 0, 0, -0.5, -1, 0]);

const pad = (index, pose) => ({ index, id:`Pad ${index}`, mapping:'standard', buttons:[], axes:[], pose });
pads = [pad(0), pad(1, { angularVelocity:[0, Math.PI, 0], linearAcceleration:[0, 0, gravity] })];
controls.setMultiplayer(true);
tick();
assert.deepEqual(connected, [1], 'motion alone connects the assigned multiplayer controller');
check([0, 0.5, 0, 0, 0, -2], 1);
check([0, 0, 0, -0.5, -1, 0], 0);
controls.setMultiplayer(false);
tick();
check(rest, 1);
check([0, 0.5, 0, 0, 0, -2], 0);
key('Digit3');
tick();
check([0, 0, 0.5, 0, 0, -1]);
modal = true;
event('nx-release-input');
check(rest);
tick();
check(rest);
modal = false;
tick();
check([0, 0.5, 0, 0, 0, -2], 0);
document.hidden = true;
document.dispatchEvent(new Event('visibilitychange'));
check(rest);
document.hidden = false;
pads = [];
tick();
check(rest);

engine = { ...engine, _eden_set_motion:undefined };
key('Digit5'); key('Digit5', false);
tick();
assert.equal(frame, null, 'older runtimes without the optional export still work');
console.log('NX-Web motion: units, orientation wraparound, remapping, source priority, multiplayer, resets and old runtimes OK');
