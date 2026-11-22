// SPDX-License-Identifier: GPL-3.0-or-later
// Checks the save archive writer and how imported archive paths map onto Eden's save folders.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readZipEntries, writeZip } from '../web/system-files.js';
import { savePathFor, restoreSaves, watchSaves, savePointInfo, exportSaves, importSaves, loadSlot, clearSaves } from '../web/recovery.js';
import { EDEN_DATA_ROOT } from '../web/system-files.js';

const files = [
  { name: 'nand/user/save/0000000000000000/0123456789ABCDEF0123456789ABCDEF/010013C00E930000/user1.dat', data: new Uint8Array([1, 2, 3]) },
  { name: 'nand/system/save/8000000000000010/su/avators/profiles.dat', data: new Uint8Array(70_000).map((_, i) => i * 7) },
  { name: 'nand/user/save/empty.bin', data: new Uint8Array() },
  { name: 'sdmc/nxweb-save-test.txt', data: new Uint8Array([49]) },
];
const zip = writeZip(files);
const file = new File([zip], 'saves.zip');
const entries = await readZipEntries(file);
assert.deepEqual(entries.map(e => e.name), files.map(f => f.name));
for (const [i, entry] of entries.entries()) {
  assert.deepEqual(new Uint8Array(await (await entry.blob()).arrayBuffer()), files[i].data);
}

// The archive must also be valid for other tools (CRCs, headers).
const dir = await mkdtemp(path.join(tmpdir(), 'eden-saves-'));
try {
  const zipPath = path.join(dir, 'saves.zip');
  await writeFile(zipPath, new Uint8Array(await zip.arrayBuffer()));
  execFileSync('unzip', ['-tq', zipPath]);
  execFileSync('unzip', ['-q', zipPath, '-d', path.join(dir, 'out')]);
  assert.deepEqual(new Uint8Array(await readFile(path.join(dir, 'out', files[1].name))), files[1].data);
} finally {
  await rm(dir, { recursive: true, force: true });
}

const profile = '0123456789ABCDEF0123456789ABCDEF';
assert.equal(savePathFor('eden/nand/user/save/0000000000000000/AA/0100F2C0115B6000/progress.sav', profile),
  'nand/user/save/0000000000000000/AA/0100F2C0115B6000/progress.sav');
assert.equal(savePathFor('NAND\\System\\save\\8000000000000010\\su\\avators\\profiles.dat', null),
  'nand/system/save/8000000000000010/su/avators/profiles.dat');
assert.equal(savePathFor('0100f2c0115b6000/slot/0.sav', profile),
  `nand/user/save/0000000000000000/${profile}/0100F2C0115B6000/slot/0.sav`);
assert.equal(savePathFor('__MACOSX/0100F2C0115B6000/._0.sav', profile), null);
assert.equal(savePathFor('0100F2C0115B6000/.DS_Store', profile), null);
assert.equal(savePathFor('readme.txt', profile), null);
assert.equal(savePathFor('sdmc/nxweb-save-test.txt', null), 'sdmc/nxweb-save-test.txt');
assert.equal(savePathFor('sdmc', null), null);
assert.throws(() => savePathFor('sdmc/../keys/prod.keys', null), /unsafe/);
assert.throws(() => savePathFor('0100F2C0115B6000/../../keys/prod.keys', profile), /unsafe/);
assert.throws(() => savePathFor('0100F2C0115B6000/0.sav', undefined), /No user profile/);

console.log('save archives OK');

let snapshot = new Map();
const slots = new Map();
let aborts = 0;
const tick = () => new Promise(resolve => setImmediate(resolve));
const originalIndexedDB = globalThis.indexedDB;
const originalSetInterval = globalThis.setInterval;
const originalClearInterval = globalThis.clearInterval;
const originalWarn = console.warn;
let poll;
const warnings = [];
globalThis.indexedDB = {
  open() {
    const request = {};
    queueMicrotask(() => {
      request.result = {
        close() {},
        transaction(name) {
          const source = name === 'slots' ? slots : snapshot;
          const pending = new Map(source);
          let aborted = false;
          const read = result => {
            const request = {};
            queueMicrotask(() => { request.result = result; request.onsuccess?.(); });
            return request;
          };
          const tx = {
            abort() { aborted = true; aborts++; },
            objectStore: () => ({
              clear: () => pending.clear(),
              put: (value, key) => pending.set(key, value),
              get: key => read(pending.get(key)),
              getAllKeys: () => read([...pending.keys()]),
              getAll: () => read([...pending.values()]),
            }),
          };
          setImmediate(() => {
            if (aborted) tx.onabort?.();
            else { if (name !== 'slots') snapshot = pending; tx.oncomplete?.(); }
          });
          return tx;
        },
      };
      request.onsuccess();
    });
    return request;
  },
};
globalThis.setInterval = fn => { poll = fn; return 1; };
globalThis.clearInterval = () => {};
console.warn = (...args) => warnings.push(args);

try {
  const titleId = '0100F2C0115B6000';
  slots.set(1, { titleId, name: 'Test game', files: [[`nand/user/save/0000000000000000/${profile}/${titleId}/test.sav`, new Blob([new Uint8Array([7])])]] });
  await assert.rejects(loadSlot(2, titleId), /empty/);
  await assert.rejects(loadSlot(1, '0100000000000001'), /belongs to Test game/);
  await assert.rejects(loadSlot(1, null), /belongs to Test game/);
  assert.equal(snapshot.size, 0);
  await loadSlot(1, titleId.toLowerCase());
  assert.equal(snapshot.size, 2);
  snapshot.clear();
  await loadSlot(1);
  assert.equal(snapshot.size, 2);
  snapshot.clear();
  let saved;
  const contents = new Map();
  const sdContents = new Map();
  const contentFor = path => (path.includes('/sdmc/') ? sdContents : contents).get(path.split('/').at(-1));
  let unreadable = null;
  const FS = {
    readdir(dir) {
      if (dir === `${EDEN_DATA_ROOT}/nand/user/save`) return [...contents.keys()];
      if (dir === `${EDEN_DATA_ROOT}/sdmc`) return [...sdContents.keys()];
      throw new Error('No directory');
    },
    stat(path) { return { size: contentFor(path).length, mtime: 1, mode: 0 }; },
    isDir: () => false,
    readFile(path) {
      const name = path.split('/').at(-1);
      if (name === unreadable) throw new Error('Save read failed');
      return contentFor(path);
    },
  };
  const stop = watchSaves(() => FS, () => true, meta => { saved = meta; });
  assert.equal(await savePointInfo(), undefined);
  assert.equal(await restoreSaves({}), 0);
  contents.set('previous.sav', new Uint8Array([1, 2]));
  await poll();
  await poll();
  assert.equal(saved.files, 1);
  assert.equal(saved.bytes, 2);
  const previous = new Map(snapshot);

  contents.set('previous.sav', new Uint8Array([3, 4, 5]));
  contents.set('broken.sav', new Uint8Array([6]));
  unreadable = 'broken.sav';
  await poll();
  await poll();
  await tick();
  assert.equal(aborts, 1);
  assert.match(warnings[0][1].message, /Save read failed/);
  assert.deepEqual(snapshot, previous);
  const restored = new Map();
  assert.equal(await restoreSaves({
    mkdirTree() {},
    writeFile: (path, bytes) => restored.set(path, bytes),
  }), 1);
  assert.deepEqual(restored.get(`${EDEN_DATA_ROOT}/nand/user/save/previous.sav`), new Uint8Array([1, 2]));

  unreadable = null;
  await poll();
  assert.equal(saved.files, 2);
  assert.equal(saved.bytes, 4);
  contents.clear();
  await poll();
  await poll();
  assert.equal(saved.files, 0);
  assert.equal(await restoreSaves({}), 0);
  sdContents.set('nxweb-save-test.txt', new Uint8Array([49]));
  await poll();
  await poll();
  assert.equal(saved.files, 1);
  assert.deepEqual(new Uint8Array(await snapshot.get('sdmc/nxweb-save-test.txt').arrayBuffer()), new Uint8Array([49]));
  const backup = await exportSaves();
  snapshot.clear();
  await importSaves(new File([backup], 'sdmc.zip'));
  const sdRestored = new Map();
  await restoreSaves({ mkdirTree() {}, writeFile: (path, data) => sdRestored.set(path, data) });
  assert.deepEqual(sdRestored.get(`${EDEN_DATA_ROOT}/sdmc/nxweb-save-test.txt`), new Uint8Array([49]));
  sdContents.clear();
  await poll();
  await poll();
  await stop();
  const lifecycle = new EventTarget();
  lifecycle.document = new EventTarget();
  lifecycle.document.visibilityState = 'visible';
  let healthy = true;
  const stopLifecycle = watchSaves(() => FS, () => healthy, meta => { saved = meta; }, 10_000, lifecycle);
  const settle = async () => { await tick(); await tick(); };
  sdContents.set('nxweb-save-test.txt', new Uint8Array([50]));
  lifecycle.document.dispatchEvent(new Event('visibilitychange'));
  await settle();
  assert.equal(snapshot.has('sdmc/nxweb-save-test.txt'), false);
  lifecycle.document.visibilityState = 'hidden';
  lifecycle.document.dispatchEvent(new Event('visibilitychange'));
  await settle();
  assert.deepEqual(new Uint8Array(await snapshot.get('sdmc/nxweb-save-test.txt').arrayBuffer()), new Uint8Array([50]));
  sdContents.set('nxweb-save-test.txt', new Uint8Array([51]));
  lifecycle.dispatchEvent(new Event('pagehide'));
  await settle();
  assert.deepEqual(new Uint8Array(await snapshot.get('sdmc/nxweb-save-test.txt').arrayBuffer()), new Uint8Array([51]));
  healthy = false;
  sdContents.clear();
  lifecycle.dispatchEvent(new Event('pagehide'));
  await settle();
  assert.equal(snapshot.has('sdmc/nxweb-save-test.txt'), true);
  healthy = true;
  unreadable = 'nxweb-save-test.txt';
  sdContents.set(unreadable, new Uint8Array([52]));
  lifecycle.dispatchEvent(new Event('pagehide'));
  await settle();
  assert.deepEqual(new Uint8Array(await snapshot.get('sdmc/nxweb-save-test.txt').arrayBuffer()), new Uint8Array([51]));
  unreadable = null;
  sdContents.clear();
  lifecycle.dispatchEvent(new Event('pagehide'));
  await stopLifecycle();
  assert.equal(snapshot.has('sdmc/nxweb-save-test.txt'), false);
  sdContents.set('late.txt', new Uint8Array([1]));
  lifecycle.dispatchEvent(new Event('pagehide'));
  await settle();
  assert.equal(snapshot.has('sdmc/late.txt'), false);
  const stopClear = watchSaves(() => FS, () => true, () => {}, 10_000, lifecycle);
  lifecycle.dispatchEvent(new Event('pagehide'));
  await clearSaves(stopClear);
  assert.equal(snapshot.size, 0);
  sdContents.set('later.txt', new Uint8Array([2]));
  lifecycle.dispatchEvent(new Event('pagehide'));
  await poll();
  await poll();
  await settle();
  assert.equal(snapshot.size, 0);
  await clearSaves();
  await assert.rejects(clearSaves(() => Promise.reject(new Error('stop failed'))), /stop failed/);
} finally {
  globalThis.indexedDB = originalIndexedDB;
  globalThis.setInterval = originalSetInterval;
  globalThis.clearInterval = originalClearInterval;
  console.warn = originalWarn;
}
console.log('save snapshots: empty, replace, partial-read rollback, restore and retry OK');
