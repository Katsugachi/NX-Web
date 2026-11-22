// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import { ACTIONS, DEFAULT_BINDINGS } from '../web/bindings.js';
import { setupInput, Button } from '../web/input.js';
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
key('keyup','KeyV');
let frame;
globalThis.requestAnimationFrame = callback=>{frame=callback;};
let pads = [{index:0,id:'Test controller',mapping:'standard',buttons:[{pressed:true,value:1}],axes:[0.5,0,0,0]}];
navigator.getGamepads = ()=>pads;
window.dispatchEvent(new Event('gamepadconnected'));
assert.equal(buttons.get(Button.B),1,'standard bottom button maps to Switch B by position');
assert.deepEqual(sticks.get(0),[0.5,0]);
pads=[]; frame();
assert.equal(buttons.get(Button.B),0,'disconnect releases buttons');
assert.deepEqual(sticks.get(0),[0,0]);
controls.setLayout('label');
pads=[{index:0,id:'Test controller',mapping:'standard',buttons:[{pressed:true,value:1}],axes:[]}];
window.dispatchEvent(new Event('gamepadconnected'));
assert.equal(buttons.get(Button.A),1,'label mode maps the bottom button to A');
pads=[]; frame();
assert.equal(buttons.get(Button.A),0);
console.log('NX-Web input: all 25 defaults, remapping, diagonals, modal guards and gamepad connect/disconnect OK');
