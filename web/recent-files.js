// SPDX-License-Identifier: GPL-3.0-or-later
// File handles for recently opened games, so a recent tile can reopen its game without the file
// picker. Only the handle (a reference the browser grants) is stored, never the game itself.
const STORE = 'handles';

function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('nx-recent-files', 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, action) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const result = action(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(result?.result);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export const canPickHandles = () => typeof window.showOpenFilePicker === 'function';

export async function pickGame(extensions) {
  const [handle] = await window.showOpenFilePicker({
    id: 'nx-games',
    types: [{ description: 'Switch games and archives', accept: { 'application/octet-stream': extensions } }],
  });
  return { file: await handle.getFile(), handle };
}

export async function rememberHandle(name, handle, keep) {
  if (handle?.kind !== 'file') return;
  await withStore('readwrite', store => {
    store.put(handle, name);
    const keys = store.getAllKeys();
    keys.onsuccess = () => { for (const key of keys.result) if (!keep.includes(key)) store.delete(key); };
  }).catch(() => {});
}

export const forgetHandles = () => withStore('readwrite', store => store.clear()).catch(() => {});

// Resolves to the game's current File, or null when no handle is stored for it. Rejects when the
// browser refuses access or the file is gone.
export async function reopenGame(name) {
  const handle = await withStore('readonly', store => store.get(name)).catch(() => null);
  if (!handle) return null;
  if (await handle.queryPermission({ mode: 'read' }) !== 'granted'
    && await handle.requestPermission({ mode: 'read' }) !== 'granted') {
    throw Object.assign(new Error('permission denied'), { name: 'NotAllowedError' });
  }
  return { file: await handle.getFile(), handle };
}
