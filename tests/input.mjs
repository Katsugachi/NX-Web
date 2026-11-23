// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import { ACTIONS, DEFAULT_BINDINGS } from '../web/bindings.js';
import { setupInput, Button } from '../web/input.js';
import { setupTouchscreen, touchscreenPosition } from '../web/touchscreen.js';
globalThis.window = new EventTarget();
globalThis.document = Object.assign(new EventTarget(), { querySelector:()=>null, hidden:false });
globalThis.HTMLElement = class {};
globalThis.localStorage = {getItem:()=>null};
Object.defineProperty(globalThis,'navigator',{value:{getGamepads:()=>[]}, configurable:true});
const buttons = new Map();
const sticks = new Map();
const engine = {
  _eden_set_button:(player,button,value)=>buttons.set(button,value),
  _eden_set_stick:(player,stick,x,y)=>sticks.set(stick,[x,y]),
};
const controls = setupInput(()=>engine);
function key(type,code,props={}) { const event = new Event(type,{cancelable:true}); Object.assign(event,{code,...props}); window.dispatchEvent(event); return event; }
for (const action of ACTIONS.filter(action=>!action.hotkey)) {
  key('keydown',action.key);
  if (action.button) assert.equal(buttons.get(Button[action.button]),1,action.label);
  if (action.vector) assert.deepEqual(sticks.get(action.vector[0]),action.vector.slice(1),action.label);
  key('keyup',action.key);
  if (action.button) assert.equal(buttons.get(Button[action.button]),0);
  if (action.vector) assert.deepEqual(sticks.get(action.vector[0]),[0,0]);
}
key('keydown','KeyW'); key('keydown','KeyD');
assert.ok(Math.abs(Math.hypot(...sticks.get(0))-1)<1e-10,'diagonal is normalized');
window.dispatchEvent(new Event('blur'));
assert.deepEqual(sticks.get(0),[0,0]);
key('keydown','KeyL');
window.dispatchEvent(new CustomEvent('nx-bindings',{detail:{...DEFAULT_BINDINGS,a:'KeyV'}}));
assert.equal(buttons.get(Button.A),0,'remapping releases held buttons');
key('keydown','KeyV'); assert.equal(buttons.get(Button.A),1);
window.dispatchEvent(new Event('nx-release-input')); assert.equal(buttons.get(Button.A),0);
document.querySelector = selector=>selector==='dialog[open]'?{}:null;
key('keydown','KeyV'); assert.equal(buttons.get(Button.A),0,'dialogs suppress controller keys');
document.querySelector = ()=>null;
key('keydown','KeyV',{ctrlKey:true}); assert.equal(buttons.get(Button.A),0,'browser modifiers are ignored');
assert.equal(key('keydown','KeyV').defaultPrevented,true);
const focusSelect = new Event('focusin');
Object.defineProperty(focusSelect, 'target', { value:{ tagName:'SELECT' } });
document.dispatchEvent(focusSelect);
assert.equal(buttons.get(Button.A),0,'focusing a form field releases held controls');
key('keyup','KeyV');
const activate = new Event('keydown', { cancelable:true });
Object.assign(activate, { code:'Enter', key:'Enter' });
Object.defineProperty(activate, 'target', { value:{ tagName:'BUTTON' } });
window.dispatchEvent(activate);
assert.equal(activate.defaultPrevented,false,'Enter activates a focused button instead of sending Plus');
assert.equal(buttons.get(Button.Plus),0);
let frame;
globalThis.requestAnimationFrame = callback=>{frame=callback;};
let pads = [{index:0,id:'Test controller',mapping:'standard',buttons:[{pressed:true,value:1}],axes:[0.5,0,0,0]}];
navigator.getGamepads = ()=>pads;
window.dispatchEvent(new Event('gamepadconnected'));
assert.equal(buttons.get(Button.B),1,'standard bottom button maps to Switch B by position');
assert.deepEqual(sticks.get(0),[0.5,0]);
window.dispatchEvent(new Event('nx-release-input'));
assert.equal(buttons.get(Button.B),0,'opening a dialog releases held gamepad buttons immediately');
assert.deepEqual(sticks.get(0),[0,0],'opening a dialog centers the gamepad stick immediately');
document.querySelector = selector=>selector==='dialog[open]'?{}:null;
frame();
assert.equal(buttons.get(Button.B),0,'polling with a dialog open does not reapply held gamepad buttons');
assert.deepEqual(sticks.get(0),[0,0],'polling with a dialog open does not move gamepad sticks');
document.querySelector = ()=>null;
frame();
assert.equal(buttons.get(Button.B),1,'gamepad input resumes after closing the dialog');
assert.deepEqual(sticks.get(0),[0.5,0]);
document.querySelector = selector=>selector==='dialog[open]'?{}:null;
frame();
assert.equal(buttons.get(Button.B),0,'polling also releases state for dialogs opened without an event');
assert.deepEqual(sticks.get(0),[0,0]);
document.querySelector = ()=>null;
frame();
pads=[]; frame();
assert.equal(buttons.get(Button.B),0,'disconnect releases buttons');
assert.deepEqual(sticks.get(0),[0,0]);
controls.setLayout('label');
pads=[{index:0,id:'Test controller',mapping:'standard',buttons:[{pressed:true,value:1}],axes:[]}];
window.dispatchEvent(new Event('gamepadconnected'));
assert.equal(buttons.get(Button.A),1,'label mode maps the bottom button to A');
pads=[]; frame();
assert.equal(buttons.get(Button.A),0);
console.log('NX-Web input: defaults, remapping, diagonals, modal guards and gamepad connect/disconnect OK');

const rect = { left:100, top:50, width:800, height:600 };
assert.deepEqual(touchscreenPosition(rect, 500, 350), [640, 360]);
assert.deepEqual(touchscreenPosition(rect, 100, 125), [0, 0]);
assert.equal(touchscreenPosition(rect, 500, 124), null, 'top letterbox ignored');
assert.equal(touchscreenPosition(rect, 500, 575), null, 'bottom edge excluded');
assert.equal(touchscreenPosition(rect, 900, 350), null, 'right edge excluded');
assert.deepEqual(touchscreenPosition(rect, 899.9, 574.9), [1279, 719]);
assert.deepEqual(touchscreenPosition(rect, 100, 50, 16 / 9, true), [0, 0], 'stretched canvas');
assert.equal(touchscreenPosition({ left:0, top:0, width:1600, height:450 }, 100, 225), null,
  'pillarbox ignored');
assert.deepEqual(touchscreenPosition({ left:0, top:0, width:1600, height:900 }, 800, 450), [640, 360],
  'CSS coordinates do not depend on device pixel ratio');
for (const invalid of [{ ...rect, width:0 }, { ...rect, height:-1 }, { ...rect, left:NaN }]) {
  assert.equal(touchscreenPosition(invalid, 500, 350), null);
}
assert.equal(touchscreenPosition(rect, NaN, 0), null);
const canvas = Object.assign(new EventTarget(), {
  style:{}, width:1280, height:720, getBoundingClientRect:()=>rect,
  setPointerCapture:()=>{}, hasPointerCapture:()=>false,
});
globalThis.getComputedStyle = () => ({ objectFit:'contain' });
const touches = [];
let touchModule = { _eden_set_touch:(...args)=>touches.push(args) };
setupTouchscreen(canvas, ()=>touchModule);
const pointerEvent = (type, pointerId, clientX=500, clientY=350, button=0) => {
  const event = new Event(type, { cancelable:true });
  Object.assign(event, { pointerId, clientX, clientY, button });
  canvas.dispatchEvent(event);
  return event;
};
pointerEvent('pointerdown', 9, 500, 80);
pointerEvent('pointerdown', 10, 500, 350, 2);
pointerEvent('pointermove', 11);
assert.equal(touches.length, 0, 'outside, secondary button and hover ignored');
assert.equal(pointerEvent('pointerdown', 100).defaultPrevented, true);
pointerEvent('pointerdown', 200, 300, 350);
assert.deepEqual(touches.slice(-2), [[0,640,360,1], [1,320,360,1]], 'independent contacts');
pointerEvent('pointermove', 100, 700, 350);
assert.deepEqual(touches.at(-1), [0,960,360,1]);
pointerEvent('pointerup', 200);
assert.deepEqual(touches.at(-1), [1,0,0,0], 'release only that contact');
pointerEvent('pointermove', 100, 500, 80);
assert.deepEqual(touches.at(-1), [0,0,0,0], 'dragging into letterbox releases');
for (const type of ['pointercancel', 'pointerleave', 'lostpointercapture']) {
  pointerEvent('pointerdown', 1);
  pointerEvent(type, 1);
  assert.deepEqual(touches.at(-1), [0,0,0,0], type);
}
for (const type of ['blur', 'nx-release-input']) {
  pointerEvent('pointerdown', 1);
  window.dispatchEvent(new Event(type));
  assert.deepEqual(touches.at(-1), [0,0,0,0], type);
}
pointerEvent('pointerdown', 1);
document.hidden = true;
document.dispatchEvent(new Event('visibilitychange'));
assert.deepEqual(touches.at(-1), [0,0,0,0], 'hidden document releases');
document.hidden = false;
document.querySelector = selector=>selector==='dialog[open]'?{}:null;
const beforeDialog = touches.length;
pointerEvent('pointerdown', 1);
assert.equal(touches.length, beforeDialog, 'dialogs suppress touches');
document.querySelector = ()=>null;
for (let i=0; i<17; i++) pointerEvent('pointerdown', i);
assert.equal(touches.length - beforeDialog, 16, 'at most sixteen active contacts');
assert.equal(touches.filter(t=>t[3]===1).slice(-16).length, 16);
const count = touches.length;
pointerEvent('pointermove', 16);
assert.equal(touches.length, count, 'seventeenth contact ignored');
window.dispatchEvent(new Event('nx-release-input'));
assert.equal(touches.slice(-16).every(t=>t[3]===0), true);
pointerEvent('pointerdown', 1);
touchModule = null;
pointerEvent('pointermove', 1);
assert.deepEqual(touches.at(-1), [0,0,0,0], 'release original module after shutdown');
pointerEvent('pointerdown', 1);
assert.deepEqual(touches.at(-1), [0,0,0,0], 'unavailable engine ignored');
console.log('NX-Web touchscreen: letterbox/scale/stretch mapping, multitouch, capacity and release lifecycle OK');
