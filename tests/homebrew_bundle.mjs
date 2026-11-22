// SPDX-License-Identifier: GPL-3.0-or-later

import assert from 'node:assert/strict';
import { bundledSdFiles, homebrewRomPath, mountBundledSdFiles } from '../web/homebrew-bundle.js';
import { EDEN_DATA_ROOT, readZipEntries, writeZip } from '../web/system-files.js';

const rom = 'switch/quake/quake.nro';
assert.equal(homebrewRomPath(rom), `${EDEN_DATA_ROOT}/sdmc/switch/quake/quake.nro`);
assert.equal(homebrewRomPath('switch/custom/engine.nro'), `${EDEN_DATA_ROOT}/sdmc/switch/custom/engine.nro`);
assert.equal(homebrewRomPath('quake.nro'), `${EDEN_DATA_ROOT}/sdmc/switch/quake/quake.nro`);
assert.equal(homebrewRomPath('archive/quake.nro'), `${EDEN_DATA_ROOT}/sdmc/switch/quake/quake.nro`);
assert.equal(homebrewRomPath('my app.NRO'), `${EDEN_DATA_ROOT}/sdmc/switch/my app/my app.NRO`);
assert.equal(homebrewRomPath('archive/game.nsp'), '/roms/game.nsp');
assert.throws(() => homebrewRomPath(''), /unsafe/);
assert.throws(() => homebrewRomPath('switch/../game.nro'), /unsafe/);
const asset = 'switch/quake/id1/pak0.pak';
const config = 'switch/quake/id1/config.cfg';
const data = Uint8Array.of(1, 2, 3);
const entries = await readZipEntries(new File([writeZip([
  rom, asset, config, 'switch/quake/id1/.DS_Store', 'switch/quake/._cover.png', 'switch/other/data',
].map(name => ({ name, data })))], 'quake.zip'));
const picked = bundledSdFiles(entries, [entries[0]]);
assert.deepEqual(picked.map(entry => entry.name), [asset, config]);
assert.deepEqual(bundledSdFiles(entries, [{ name: 'quake.nro' }]), picked);
assert.deepEqual(bundledSdFiles(entries, [{ name: 'game.nsp' }]), []);
assert.deepEqual(bundledSdFiles(entries, [entries[0], { name: 'other.nro' }]), []);
assert.throws(() => bundledSdFiles([...entries, { name: 'switch/quake/../../../keys/prod.keys' }], [entries[0]]), /unsafe/);
assert.throws(() => bundledSdFiles([...entries, picked[0]], [entries[0]]), /duplicate/);
assert.throws(() => bundledSdFiles([{ ...picked[0], size: 2 ** 30 }], [entries[0]]), /exceed/);
assert.throws(() => bundledSdFiles([{ ...picked[0], supported: false }], [entries[0]]), /unsupported/);

const full = name => `${EDEN_DATA_ROOT}/sdmc/${name}`;
const installed = new Map([[full(config), Uint8Array.of(4)]]);
const fs = {
  analyzePath: name => ({ exists: installed.has(name) }),
  mkdirTree() {},
  writeFile: (name, bytes) => installed.set(name, bytes),
  unlink: name => installed.delete(name),
};
const broken = { ...picked[0], name: 'switch/quake/broken', size: 2 };
await assert.rejects(mountBundledSdFiles(fs, [...picked, broken]), /exceeds its declared ZIP size/);
assert.deepEqual([...installed.keys()], [full(config)]);
await assert.rejects(mountBundledSdFiles(fs, [{ ...broken, size: 4 }]), /truncated/);
const mounted = await mountBundledSdFiles(fs, picked);
assert.deepEqual(mounted.installed, [`sdmc/${asset}`]);
assert.deepEqual(installed.get(full(asset)), data);
assert.deepEqual(installed.get(full(config)), Uint8Array.of(4));
mounted.close();
assert.deepEqual([...installed.keys()], [full(config)]);
console.log('Homebrew bundle: matching app folder only, bounds, rollback and existing saves OK');
