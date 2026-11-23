// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import { acquireSession, createSessionLaunch } from '../web/session-lock.js';

const selections = [];
const pendingFiles = [];
const queued = createSessionLaunch({ launch: file => selections.push(file), onPending: file => pendingFiles.push(file) });
queued.select(null);
queued.select('first');
queued.setOwned(false);
queued.select('latest');
assert.deepEqual(selections, []);
assert.deepEqual(pendingFiles, ['first', 'latest']);
queued.setOwned(true);
assert.deepEqual(selections, ['latest'], 'only the latest selection survives checking/blocked');
queued.setOwned(true);
assert.deepEqual(selections, ['latest'], 'ownership notifications cannot replay a launch');
queued.select('owned');
assert.deepEqual(selections, ['latest', 'owned']);
queued.setOwned(false);
queued.select('waiting');
assert.deepEqual(selections, ['latest', 'owned'], 'losing ownership gates launches again');
queued.setOwned(true);
assert.deepEqual(selections, ['latest', 'owned', 'waiting']);
const deniedLaunch = createSessionLaunch({ launch: async () => { throw new Error('invalid file'); }, onPending() {} });
deniedLaunch.select('bad');
await assert.rejects(deniedLaunch.setOwned(true), /invalid file/);
assert.equal(deniedLaunch.setOwned(true), undefined, 'a failed launch is not replayed');

const statuses = [];
assert.equal(await acquireSession(status => statuses.push(status), null), true);
assert.deepEqual(statuses.splice(0), ['acquired']);

let held;
const available = { request(name, options, callback) {
  assert.equal(name, 'nx-web-session');
  assert.deepEqual(options, { mode: 'exclusive', ifAvailable: true });
  held = callback({ name });
  return held;
} };
assert.equal(await acquireSession(status => statuses.push(status), available), true);
assert.deepEqual(statuses.splice(0), ['checking', 'acquired']);
const pending = Symbol();
assert.equal(await Promise.race([held, Promise.resolve(pending)]), pending);

let grant;
let requests = 0;
const occupied = { request(name, options, callback) {
  assert.equal(name, 'nx-web-session');
  requests++;
  if (options.ifAvailable) return callback(null);
  assert.deepEqual(options, { mode: 'exclusive' });
  grant = () => callback({ name });
  return new Promise(() => {});
} };
const waiting = acquireSession(status => statuses.push(status), occupied);
await new Promise(resolve => setImmediate(resolve));
assert.deepEqual(statuses.splice(0), ['checking', 'blocked']);
assert.equal(requests, 2);
assert.equal(await Promise.race([waiting, Promise.resolve(pending)]), pending);
held = grant();
assert.equal(await waiting, true);
assert.deepEqual(statuses.splice(0), ['acquired']);
assert.equal(await Promise.race([held, Promise.resolve(pending)]), pending);

for (const request of [() => Promise.reject(new Error('denied')), () => { throw new Error('denied'); }]) {
  assert.equal(await acquireSession(status => statuses.push(status), { request }), false);
  assert.deepEqual(statuses.splice(0), ['checking', 'error']);
}
console.log('Session lock: exclusive lifetime, waiting handoff, missing API and request failures OK');
