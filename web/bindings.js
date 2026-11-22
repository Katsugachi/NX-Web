// SPDX-License-Identifier: GPL-3.0-or-later
export const ACTIONS = [
  { id:'leftUp', label:'Left stick up', key:'KeyW', vector:[0,0,1] },
  { id:'leftLeft', label:'Left stick left', key:'KeyA', vector:[0,-1,0] },
  { id:'leftDown', label:'Left stick down', key:'KeyS', vector:[0,0,-1] },
  { id:'leftRight', label:'Left stick right', key:'KeyD', vector:[0,1,0] },
  { id:'rightUp', label:'Right stick up', key:'KeyT', vector:[1,0,1] },
  { id:'rightLeft', label:'Right stick left', key:'KeyF', vector:[1,-1,0] },
  { id:'rightDown', label:'Right stick down', key:'KeyG', vector:[1,0,-1] },
  { id:'rightRight', label:'Right stick right', key:'KeyH', vector:[1,1,0] },
  { id:'dpadUp', label:'D-pad up', key:'ArrowUp', button:'Up' },
  { id:'dpadLeft', label:'D-pad left', key:'ArrowLeft', button:'Left' },
  { id:'dpadDown', label:'D-pad down', key:'ArrowDown', button:'Down' },
  { id:'dpadRight', label:'D-pad right', key:'ArrowRight', button:'Right' },
  { id:'a', label:'A', key:'KeyL', button:'A' },
  { id:'b', label:'B', key:'KeyK', button:'B' },
  { id:'x', label:'X', key:'KeyI', button:'X' },
  { id:'y', label:'Y', key:'KeyJ', button:'Y' },
  { id:'l', label:'L', key:'KeyQ', button:'L' },
  { id:'r', label:'R', key:'KeyO', button:'R' },
  { id:'zl', label:'ZL', key:'KeyE', button:'ZL' },
  { id:'zr', label:'ZR', key:'KeyU', button:'ZR' },
  { id:'plus', label:'Plus', key:'Enter', button:'Plus' },
  { id:'minus', label:'Minus', key:'Backspace', button:'Minus' },
  { id:'l3', label:'Left stick click', key:'KeyC', button:'LStick' },
  { id:'r3', label:'Right stick click', key:'KeyN', button:'RStick' },
  { id:'home', label:'Home', key:'Backquote', button:'Home' },
  { id:'open', label:'Open game · library only', key:'KeyO', hotkey:true },
  { id:'pause', label:'Pause / resume', key:'KeyP', hotkey:true },
  { id:'save', label:'Save slot', key:'F5', hotkey:true },
  { id:'load', label:'Load slot', key:'F8', hotkey:true },
  { id:'fullscreen', label:'Fullscreen', key:'F11', hotkey:true },
  { id:'settings', label:'Settings', key:'Tab', hotkey:true },
  { id:'bar', label:'Show player bar / close drawer', key:'Escape', hotkey:true },
  { id:'shortcuts', label:'Shortcuts', key:'Shift+Slash', hotkey:true },
];
export const DEFAULT_BINDINGS = Object.fromEntries(ACTIONS.map(action => [action.id, action.key]));
const STORAGE_KEY = 'nx-keyboard-bindings';
const validKey = key => typeof key === 'string' && /^(Shift\+)?(Key[A-Z]|Digit[0-9]|F[1-9]|F1[0-2]|Arrow(Up|Down|Left|Right)|Enter|Backspace|Escape|Tab|Space|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|CapsLock|Insert|Delete|Home|End|PageUp|PageDown)$/.test(key);
export function bindingKey(event) { return `${event.shiftKey ? 'Shift+' : ''}${event.code}`; }
export function isKeyboardField(target) {
  return target?.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(target?.tagName);
}
export function usesNativeKeys(event) {
  return isKeyboardField(event.target)
    || (event.key === 'Enter' && /^(A|BUTTON)$/.test(event.target?.tagName))
    || (event.key === ' ' && event.target?.tagName === 'BUTTON');
}
export function keyLabel(key) {
  return key.replace(/Key|Digit/g, '').replace('Shift+Slash', '?').replace('Backquote', '`')
    .replace('ArrowUp', '↑').replace('ArrowDown', '↓').replace('ArrowLeft', '←').replace('ArrowRight', '→');
}
export function bindingConflict(bindings, id, key) {
  const target = ACTIONS.find(action => action.id === id);
  return ACTIONS.find(action => action.id !== id && bindings[action.id] === key
    && !(id === 'open' && !action.hotkey) && !(action.id === 'open' && !target?.hotkey));
}
export function parseBindings(raw) {
  try {
    const saved = JSON.parse(raw ?? '{}');
    const result = Object.fromEntries(ACTIONS.map(action => [action.id, validKey(saved[action.id]) ? saved[action.id] : action.key]));
    if (ACTIONS.some(action => bindingConflict(result, action.id, result[action.id]))) return { ...DEFAULT_BINDINGS };
    return result;
  } catch { return { ...DEFAULT_BINDINGS }; }
}
export function readBindings() {
  try { return parseBindings(localStorage.getItem(STORAGE_KEY)); } catch { return { ...DEFAULT_BINDINGS }; }
}
export function rebind(bindings, id, key) {
  if (!Object.hasOwn(DEFAULT_BINDINGS, id) || !validKey(key)) throw new Error('Choose a letter, number, arrow or function key.');
  const conflict = bindingConflict(bindings, id, key);
  if (conflict) throw new Error(`${keyLabel(key)} is already used by ${conflict.label}. Rebind that control first.`);
  return { ...bindings, [id]:key };
}
export function writeBindings(bindings) {
  let stored = true;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings)); } catch { stored = false; }
  window.dispatchEvent(new CustomEvent('nx-bindings', { detail:bindings }));
  return stored;
}
