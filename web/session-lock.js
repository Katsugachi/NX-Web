// SPDX-License-Identifier: GPL-3.0-or-later

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
