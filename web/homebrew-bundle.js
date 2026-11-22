// SPDX-License-Identifier: GPL-3.0-or-later

import { EDEN_DATA_ROOT } from './system-files.js';

const MAX_ASSETS = 4096;
const MAX_BYTES = 256 * 1024 * 1024;
const ROM = /\.(nsp|xci|nro|nca|nso)$/i;

function safeParts(name) {
  const parts = name.split('/');
  if (/[\\:\0]/.test(name) || parts.some(part => !part || part === '.' || part === '..')) {
    throw new Error(`${name}: unsafe homebrew asset path`);
  }
  return parts;
}

export function bundledSdFiles(entries, roms) {
  if (roms.length !== 1 || !/\.nro$/i.test(roms[0].name)) return [];
  const name = roms[0].name;
  const [top, folder, ...rest] = name.split('/');
  if (folder && top !== 'switch') return [];
  const appFolder = rest.length ? folder : (folder ?? top).slice(0, -4);
  if (!appFolder) return [];
  const prefix = `switch/${appFolder}/`;

  const files = [];
  const paths = new Set();
  let bytes = 0;
  for (const entry of entries) {
    if (!entry.name.startsWith(prefix) || ROM.test(entry.name)) continue;
    const parts = safeParts(entry.name);
    if (parts.some(part => part === '.DS_Store' || part.startsWith('._'))) continue;
    if (paths.has(entry.name)) throw new Error(`${entry.name}: duplicate homebrew asset`);
    if (!entry.supported || !Number.isSafeInteger(entry.size) || entry.size < 0) {
      throw new Error(`${entry.name}: unsupported homebrew ZIP entry`);
    }
    bytes += entry.size;
    if (files.length >= MAX_ASSETS || bytes > MAX_BYTES) {
      throw new Error('Homebrew ZIP assets exceed 4096 files or 256 MiB');
    }
    paths.add(entry.name);
    files.push(entry);
  }
  return files;
}

async function readAsset(entry) {
  const data = new Uint8Array(entry.size);
  const reader = (await entry.stream()).getReader();
  let offset = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.length > data.length - offset) {
        throw new Error(`${entry.name}: homebrew asset exceeds its declared ZIP size`);
      }
      data.set(value, offset);
      offset += value.length;
    }
    if (offset !== data.length) throw new Error(`${entry.name}: truncated homebrew asset`);
    return data;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function mountBundledSdFiles(FS, files) {
  const installed = [];
  const close = () => {
    for (const path of installed) FS.unlink(`${EDEN_DATA_ROOT}/${path}`);
  };
  try {
    for (const entry of files) {
      const path = `sdmc/${entry.name}`;
      const full = `${EDEN_DATA_ROOT}/${path}`;
      if (FS.analyzePath(full).exists) continue;
      const data = await readAsset(entry);
      FS.mkdirTree(full.slice(0, full.lastIndexOf('/')));
      FS.writeFile(full, data, { canOwn: true });
      installed.push(path);
    }
    return { installed, close };
  } catch (error) {
    close();
    throw error;
  }
}
