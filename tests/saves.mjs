// SPDX-License-Identifier: GPL-3.0-or-later
// Checks the save archive writer and how imported archive paths map onto Eden's save folders.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readZipEntries, writeZip } from '../web/system-files.js';
import { savePathFor, restoreSaves, trackBundledSdFiles, persistSaves, watchSaves, savePointInfo, exportSaves, importSaves, loadSlot, clearSaves } from '../web/recovery.js';
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
let transactions = 0;
const tick = () => new Promise(resolve => setImmediate(resolve));
const originalIndexedDB = globalThis.indexedDB;
const originalSetInterval = globalThis.setInterval;
const originalClearInterval = globalThis.clearInterval;
const originalWarn = console.warn;
const originalLocalStorage = globalThis.localStorage;
const journalStorage = new Map();
globalThis.localStorage = {
  getItem: key => journalStorage.get(key) ?? null,
  setItem: (key, value) => journalStorage.set(key, value),
  removeItem: key => journalStorage.delete(key),
};
const journalKey = 'nx-web-save-journal';
let poll;
let pollInterval;
let failTransaction = false;
const warnings = [];
globalThis.indexedDB = {
  open() {
    const request = {};
    queueMicrotask(() => {
      request.result = {
        close() {},
        transaction(name, mode) {
          transactions++;
          const source = name === 'slots' ? slots : snapshot;
          const pending = new Map(source);
          let aborted = mode === 'readwrite' && failTransaction;
          if (mode === 'readwrite') failTransaction = false;
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
globalThis.setInterval = (fn, interval) => { poll = fn; pollInterval = interval; return 1; };
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
  assert.equal(pollInterval, 2000);
  assert.equal(await savePointInfo(), undefined);
  assert.equal(await restoreSaves({}), 0);
  contents.set('previous.sav', new Uint8Array([1, 2]));
  await poll();
  assert.equal(saved.files, 1);
  assert.equal(saved.bytes, 2);
  const previous = new Map(snapshot);

  contents.set('previous.sav', new Uint8Array([3, 4, 5]));
  contents.set('broken.sav', new Uint8Array([6]));
  unreadable = 'broken.sav';
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
  sdContents.set('asset.dat', new Uint8Array([20]));
  trackBundledSdFiles(FS, ['sdmc/asset.dat']);
  await persistSaves(FS);
  assert.equal(snapshot.has('sdmc/asset.dat'), false);
  sdContents.set('asset.dat', new Uint8Array([20, 21]));
  await persistSaves(FS);
  assert.equal(snapshot.has('sdmc/asset.dat'), true);
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
  const beforeHidden = transactions;
  lifecycle.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(transactions, beforeHidden + 1, 'hidden flush must start its transaction before the event returns');
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

  sdContents.clear();
  contents.clear();
  contents.set('kept.sav', new Uint8Array([1]));
  sdContents.set('deleted.txt', new Uint8Array([2]));
  const stopJournal = watchSaves(() => FS, () => true, () => {}, 2000, lifecycle);
  lifecycle.dispatchEvent(new Event('pagehide'));
  await settle();
  const baseline = new Map(snapshot);
  sdContents.delete('deleted.txt');
  sdContents.set('counter.txt', new Uint8Array([0, 255, 128]));
  lifecycle.dispatchEvent(new Event('pagehide'));
  const raw = journalStorage.get(journalKey);
  const journal = JSON.parse(raw);
  assert.deepEqual(journal.changes, [['sdmc/counter.txt', 'AP+A'], ['sdmc/deleted.txt', null]]);
  await settle();
  assert.equal(journalStorage.has(journalKey), false, 'successful store clears the journal');
  await stopJournal();

  snapshot = new Map(baseline);
  journal.time = Date.now() + 1;
  journalStorage.set(journalKey, JSON.stringify(journal));
  const recovered = new Map();
  await restoreSaves({ mkdirTree() {}, writeFile: (path, data) => recovered.set(path, data) });
  assert.deepEqual(recovered.get(`${EDEN_DATA_ROOT}/sdmc/counter.txt`), new Uint8Array([0, 255, 128]));
  assert.equal(recovered.has(`${EDEN_DATA_ROOT}/sdmc/deleted.txt`), false);
  assert.deepEqual(recovered.get(`${EDEN_DATA_ROOT}/nand/user/save/kept.sav`), new Uint8Array([1]));
  assert.equal(snapshot.has('sdmc/counter.txt'), true);
  assert.equal(journalStorage.has(journalKey), false, 'restore commits the merged snapshot before clearing');

  snapshot.clear();
  journalStorage.set(journalKey, raw);
  await restoreSaves({ mkdirTree() {}, writeFile() {} });
  assert.equal(snapshot.has('sdmc/counter.txt'), true, 'journal also recovers an empty database');
  journalStorage.set(journalKey, raw);
  const stopNormal = watchSaves(() => FS, () => true, () => {}, 2000, lifecycle);
  sdContents.set('normal.txt', new Uint8Array([3]));
  await poll();
  assert.equal(journalStorage.has(journalKey), false, 'normal polling also clears the journal');
  sdContents.set('pending.txt', new Uint8Array([4]));
  const pendingStore = poll();
  sdContents.set('newer.txt', new Uint8Array([5]));
  lifecycle.dispatchEvent(new Event('pagehide'));
  const newer = journalStorage.get(journalKey);
  await pendingStore;
  assert.equal(journalStorage.get(journalKey), newer, 'an older in-flight store cannot clear a newer journal');
  await stopNormal();
  journalStorage.set(journalKey, JSON.stringify({ time:Date.now() + 100, changes:[['sdmc/retry.txt', 'AQ==']] }));
  const retryJournal = journalStorage.get(journalKey);
  failTransaction = true;
  const writebackRecovery = new Map();
  await restoreSaves({ mkdirTree() {}, writeFile: (path, data) => writebackRecovery.set(path, data) });
  assert.deepEqual(writebackRecovery.get(`${EDEN_DATA_ROOT}/sdmc/retry.txt`), new Uint8Array([1]), 'failed writeback still restores journaled saves into FS');
  assert.deepEqual(writebackRecovery.get(`${EDEN_DATA_ROOT}/sdmc/normal.txt`), new Uint8Array([3]), 'failed writeback still restores existing saves');
  assert.equal(snapshot.has('sdmc/retry.txt'), false);
  assert.ok(warnings.some(args => /writeback failed/.test(args[0])));
  assert.equal(journalStorage.get(journalKey), retryJournal, 'failed recovery retains the journal');
  failTransaction = true;
  await assert.rejects(importSaves(new File([backup], 'import.zip')));
  assert.equal(journalStorage.get(journalKey), retryJournal, 'management cannot bypass a failed journal merge');
  await restoreSaves({ mkdirTree() {}, writeFile() {} });
  assert.equal(snapshot.has('sdmc/retry.txt'), true, 'later recovery retries the writeback');
  assert.equal(journalStorage.has(journalKey), false);

  journalStorage.set(journalKey, JSON.stringify({ time:0, changes:[['sdmc/old.txt', 'AQ==']] }));
  await restoreSaves({ mkdirTree() {}, writeFile() {} });
  assert.equal(snapshot.has('sdmc/old.txt'), false, 'older journal does not override the snapshot');
  assert.equal(journalStorage.has(journalKey), false);
  for (const invalid of ['bad json', JSON.stringify({ time:Date.now() + 100, changes:[['sdmc/../keys/prod.keys', 'AA==']] })]) {
    journalStorage.set(journalKey, invalid);
    await restoreSaves({ mkdirTree() {}, writeFile() {} });
    assert.equal(snapshot.has('sdmc/../keys/prod.keys'), false);
  }
  await clearSaves();
  assert.equal(journalStorage.has(journalKey), false);

  const stopBounded = watchSaves(() => FS, () => true, () => {}, 2000, lifecycle);
  sdContents.set('large.txt', new Uint8Array(2 * 1024 * 1024));
  lifecycle.dispatchEvent(new Event('pagehide'));
  assert.equal(journalStorage.has(journalKey), false);
  assert.ok(warnings.some(args => /exceeds 2 MB/.test(args[1]?.message)));
  await settle();
  sdContents.delete('large.txt');
  const setItem = localStorage.setItem;
  localStorage.setItem = () => { throw new Error('quota'); };
  sdContents.set('quota.txt', new Uint8Array([1]));
  lifecycle.dispatchEvent(new Event('pagehide'));
  assert.ok(warnings.some(args => args[1]?.message === 'quota'));
  localStorage.setItem = setItem;
  await stopBounded();
  journalStorage.set(journalKey, raw);
  await clearSaves();
  assert.equal(journalStorage.has(journalKey), false);
  const otherGamePath = `nand/user/save/0000000000000000/${profile}/0100000000000001/recent.sav`;
  for (const manage of [() => importSaves(new File([backup], 'import.zip')), () => loadSlot(1)]) {
    journalStorage.set(journalKey, JSON.stringify({ time:Date.now(), changes:[[otherGamePath, 'CQ==']] }));
    await manage();
    assert.equal(journalStorage.has(journalKey), false, 'pre-boot management merges and clears the journal');
    assert.deepEqual(new Uint8Array(await snapshot.get(otherGamePath).arrayBuffer()), new Uint8Array([9]));
    const afterManagement = new Map();
    await restoreSaves({ mkdirTree() {}, writeFile: (path, data) => afterManagement.set(path, data) });
    assert.deepEqual(afterManagement.get(`${EDEN_DATA_ROOT}/${otherGamePath}`), new Uint8Array([9]), 'other games retain journaled progress after pre-boot management');
    await clearSaves();
  }
  sdContents.clear();
  contents.clear();
  const deletionFS = { ...FS };
  const stopDeletion = watchSaves(() => deletionFS, () => true, () => {}, 2000, lifecycle);
  await settle();
  sdContents.set('in-flight.txt', new Uint8Array([7]));
  const storingDeletedFile = poll();
  sdContents.delete('in-flight.txt');
  lifecycle.dispatchEvent(new Event('pagehide'));
  assert.deepEqual(JSON.parse(journalStorage.get(journalKey)).changes, [['sdmc/in-flight.txt', null]], 'journal deletes paths present only in the in-flight snapshot');
  const stoppingDeletion = stopDeletion();
  await storingDeletedFile;
  await stoppingDeletion;
  assert.equal(snapshot.has('sdmc/in-flight.txt'), true, 'simulate only the original in-flight snapshot committing');
  const afterDeletion = new Map();
  await restoreSaves({ mkdirTree() {}, writeFile: (path, data) => afterDeletion.set(path, data) });
  assert.equal(afterDeletion.has(`${EDEN_DATA_ROOT}/sdmc/in-flight.txt`), false);
  assert.equal(snapshot.has('sdmc/in-flight.txt'), false);
  assert.equal(journalStorage.has(journalKey), false);

  await clearSaves();
  const recoveryFiles = new Map();
  const recoveryFS = {
    mkdirTree() {},
    writeFile: (path, data) => recoveryFiles.set(path.split('/').at(-1), data),
    readdir(dir) { return dir === `${EDEN_DATA_ROOT}/sdmc` ? [...recoveryFiles.keys()] : []; },
    stat(path) { return { size:recoveryFiles.get(path.split('/').at(-1)).length, mtime:1, mode:0 }; },
    isDir: () => false,
    readFile: path => recoveryFiles.get(path.split('/').at(-1)),
  };
  journalStorage.set(journalKey, JSON.stringify({ time:Date.now(), changes:[['sdmc/recovered.txt', 'CQ==']] }));
  failTransaction = true;
  await restoreSaves(recoveryFS);
  const stopRecovery = watchSaves(() => recoveryFS, () => true, () => {}, 2000, lifecycle);
  await settle();
  failTransaction = true;
  const beforeRetry = transactions;
  await poll();
  assert.equal(transactions, beforeRetry + 1, 'first poll retries storing the recovered files');
  assert.equal(snapshot.has('sdmc/recovered.txt'), false);
  recoveryFiles.set('other.txt', new Uint8Array([2]));
  failTransaction = true;
  lifecycle.dispatchEvent(new Event('pagehide'));
  assert.deepEqual(JSON.parse(journalStorage.get(journalKey)).changes, [
    ['sdmc/recovered.txt', 'CQ=='],
    ['sdmc/other.txt', 'Ag=='],
  ], 'replacement journal retains recovered progress while database writes keep failing');
  await stopRecovery();
  assert.equal(snapshot.has('sdmc/recovered.txt'), false);
  assert.equal(journalStorage.has(journalKey), true);
  await clearSaves();
} finally {
  globalThis.indexedDB = originalIndexedDB;
  globalThis.setInterval = originalSetInterval;
  globalThis.clearInterval = originalClearInterval;
  console.warn = originalWarn;
  if (originalLocalStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = originalLocalStorage;
}
console.log('save snapshots: empty, replace, partial-read rollback, restore and retry OK');
