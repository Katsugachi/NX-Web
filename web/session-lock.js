// SPDX-License-Identifier: GPL-3.0-or-later

export function createSessionLaunch({ launch, onPending }) {
  let owned = false;
  let pending = null;
  return {
    select(file) {
      if (!file) return;
      if (!owned) {
        pending = file;
        onPending(file);
        return;
      }
      pending = null;
      return launch(file);
    },
    setOwned(value) {
      owned = value;
      if (!owned || !pending) return;
      const file = pending;
      pending = null;
      return launch(file);
    },
  };
}

export function acquireSession(onStatus, locks = globalThis.navigator?.locks) {
  if (!locks) {
    onStatus('acquired');
    return Promise.resolve(true);
  }
  onStatus('checking');
  return new Promise(resolve => {
    const hold = lock => {
      if (!lock) {
        onStatus('blocked');
        return locks.request('nx-web-session', { mode: 'exclusive' }, hold);
      }
      onStatus('acquired');
      resolve(true);
      return new Promise(() => {});
    };
    Promise.resolve().then(() => locks.request('nx-web-session', {
      mode: 'exclusive', ifAvailable: true,
    }, hold)).catch(() => {
      onStatus('error');
      resolve(false);
    });
  });
}
