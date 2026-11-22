// SPDX-License-Identifier: GPL-3.0-or-later

export function touchscreenPosition(rect, clientX, clientY, aspect = 16 / 9, stretched = false) {
  if (![rect.left, rect.top, rect.width, rect.height, clientX, clientY, aspect].every(Number.isFinite)
      || rect.width <= 0 || rect.height <= 0 || aspect <= 0) return null;
  let { left, top, width, height } = rect;
  if (!stretched) {
    const pictureWidth = Math.min(width, height * aspect);
    const pictureHeight = pictureWidth / aspect;
    left += (width - pictureWidth) / 2;
    top += (height - pictureHeight) / 2;
    width = pictureWidth;
    height = pictureHeight;
  }
  const x = (clientX - left) / width;
  const y = (clientY - top) / height;
  if (x < 0 || x >= 1 || y < 0 || y >= 1) return null;
  return [Math.min(1279, Math.floor(x * 1280)), Math.min(719, Math.floor(y * 720))];
}

export function setupTouchscreen(canvas, getModule) {
  if (!canvas) return;
  const contacts = new Map();
  canvas.style.touchAction = 'none';
  const position = event => touchscreenPosition(canvas.getBoundingClientRect(), event.clientX,
    event.clientY, canvas.width / canvas.height, getComputedStyle(canvas).objectFit === 'fill');
  const release = event => {
    const contact = contacts.get(event.pointerId);
    if (!contact) return;
    contacts.delete(event.pointerId);
    contact.module._eden_set_touch(contact.slot, 0, 0, 0);
    if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };
  const releaseAll = () => {
    for (const pointerId of contacts.keys()) release({ pointerId });
  };
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 || contacts.has(event.pointerId)) return;
    const module = getModule();
    if (typeof module?._eden_set_touch !== 'function' || document.querySelector('dialog[open]')) return;
    const point = position(event);
    if (!point) return;
    const used = new Set([...contacts.values()].map(contact => contact.slot));
    const slot = Array.from({ length: 16 }, (_, i) => i).find(i => !used.has(i));
    if (slot === undefined) return;
    event.preventDefault();
    if (document.activeElement !== canvas) document.activeElement?.blur?.();
    canvas.setPointerCapture(event.pointerId);
    contacts.set(event.pointerId, { slot, module });
    module._eden_set_touch(slot, ...point, 1);
  });
  canvas.addEventListener('pointermove', event => {
    const contact = contacts.get(event.pointerId);
    if (!contact) return;
    const point = position(event);
    if (!point || getModule() !== contact.module || document.querySelector('dialog[open]')) {
      release(event);
      return;
    }
    event.preventDefault();
    contact.module._eden_set_touch(contact.slot, ...point, 1);
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave', 'lostpointercapture']) {
    canvas.addEventListener(type, release);
  }
  window.addEventListener('blur', releaseAll);
  window.addEventListener('nx-release-input', releaseAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });
}
