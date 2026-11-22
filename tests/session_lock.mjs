// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import { acquireSession } from '../web/session-lock.js';

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
