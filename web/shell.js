// SPDX-License-Identifier: GPL-3.0-or-later
import { runPreflight } from './diagnostics.js';
import { recentGames, rememberGame, compatibilityProblems, runtimeProblem } from './shell-model.js';
import { ACTIONS, DEFAULT_BINDINGS, bindingKey, keyLabel, readBindings, rebind, usesNativeKeys, writeBindings } from './bindings.js';

const $ = id => document.getElementById(id);
const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${{
  open:'<path d="M12 16V4m-4 4 4-4 4 4M5 14v6h14v-6"/>',
  pause:'<path d="M8 5v14M16 5v14"/>', play:'<path d="m8 5 11 7-11 7Z"/>',
  save:'<path d="M5 4h12l3 3v13H4V4h1Zm3 0v6h8V4M8 20v-6h8v6"/>',
  load:'<path d="M12 4v12m-4-4 4 4 4-4M5 17v3h14v-3"/>',
  fullscreen:'<path d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4"/>',
  settings:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="currentColor"/><circle cx="15" cy="17" r="3" fill="currentColor"/>',
  back:'<path d="m10 5-7 7 7 7M3 12h18"/>', close:'<path d="m6 6 12 12M6 18 18 6"/>',
  game:'<rect x="5" y="3" width="14" height="18" rx="3"/><path d="M9 8h6m-6 4h4"/>',
}[name]}</svg>`;
const vault = document.createElement('div');
vault.hidden = true;
vault.id = 'bridge-elements';
for (const child of [...document.body.children]) if (child.tagName !== 'SCRIPT') vault.append(child);
document.body.append(vault);
const shell = document.createElement('main');
shell.id = 'nx-app';
shell.innerHTML = `
  <section id="library" aria-labelledby="library-title">
    <button class="icon-button library-settings" id="library-settings" title="Settings (Tab)" aria-label="Settings">${icon('settings')}</button>
    <div class="library-content">
      <h1 id="library-title">NX-Web</h1><p class="tagline">Your games. A new window.</p>
      <div id="library-drop"></div><div id="compatibility-problems" role="status" hidden></div><div id="launch-status" role="status"><p id="runtime-problem" hidden></p></div>
      <section id="recent-section" aria-label="Recently opened" hidden><div class="recent-heading"><span>Recently opened</span><button class="text-button" id="clear-recent">Clear</button></div><div id="recent-games"></div></section>
    </div>
    <button id="shortcut-hint" class="text-button shortcut-hint">Press <kbd>?</kbd> for shortcuts</button>
  </section>
  <section id="player" aria-label="Game player" hidden>
    <div id="player-stage"></div>
    <div id="player-toolbar" role="toolbar" aria-label="Player controls">
      <button id="back-library" class="icon-button" title="Back to library" aria-label="Back to library">${icon('back')}</button><div id="player-title"></div><div id="player-fps"></div>
      <button id="toggle-pause" class="icon-button" title="Pause (P)" aria-label="Pause" disabled>${icon('pause')}</button>
      <div id="toolbar-slot"></div><button id="player-fullscreen" class="icon-button" title="Fullscreen (F11)" aria-label="Fullscreen">${icon('fullscreen')}</button><button id="player-settings" class="icon-button" title="Settings (Tab)" aria-label="Settings">${icon('settings')}</button>
    </div><div id="player-message" role="status" hidden></div>
  </section>
  <dialog id="settings-drawer" aria-labelledby="settings-title">
    <div class="drawer-heading"><h2 id="settings-title">Settings</h2><button id="close-settings" class="icon-button" aria-label="Close settings">${icon('close')}</button></div>
    <div role="tablist" aria-label="Settings sections" id="settings-tabs"></div><div id="settings-panels"></div>
  </dialog>
  <dialog id="shortcuts-dialog" aria-labelledby="shortcuts-title"><div class="drawer-heading"><div><h2 id="shortcuts-title">Stay in control.</h2><p>Your keyboard is the controller.</p></div><button id="close-shortcuts" class="icon-button" aria-label="Close shortcuts">${icon('close')}</button></div><div id="shortcuts-columns"></div><p class="shortcut-footnote">Change mappings in Settings → Controls. Alt shortcuts are fixed. Gamepads connect automatically.</p></dialog>`;
document.body.append(shell);

const drawer = $('settings-drawer');
const shortcuts = $('shortcuts-dialog');
const sections = [
  ['controls', 'Controls', ['gamepads']],
  ['system', 'System files', ['system-files']],
  ['graphics', 'Graphics & core', ['emulation', 'renderer', 'speed', 'audio']],
  ['saves', 'Saves', ['save-states']],
  ['diagnostics', 'Diagnostics', ['diagnostics', 'wasm', 'performance', 'crash-recovery', 'log']],
];
function selectTab(id, focus = false) {
  for (const [key] of sections) {
    const selected = key === id;
    $(`tab-${key}`).setAttribute('aria-selected', String(selected));
    $(`tab-${key}`).tabIndex = selected ? 0 : -1;
    $(`panel-${key}`).hidden = !selected;
  }
  if (focus) $(`tab-${id}`).focus();
}
for (const [id, label, widgets] of sections) {
  const button = document.createElement('button');
  button.id = `tab-${id}`; button.textContent = label;
  button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', `panel-${id}`);
  button.addEventListener('click', () => selectTab(id)); $('settings-tabs').append(button);
  const panel = document.createElement('section');
  panel.id = `panel-${id}`; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', button.id);
  $('settings-panels').append(panel);
  for (const widget of widgets) panel.append(document.querySelector(`[data-widget="${widget}"]`));
}
$('settings-tabs').addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  let index = sections.findIndex(([id]) => `tab-${id}` === document.activeElement.id);
  index = event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + sections.length) % sections.length;
  selectTab(sections[index][0], true);
});
selectTab('controls');
function note(parent, text) {
  const element = document.createElement('p'); element.className = 'privacy-note'; element.textContent = text; $(parent).prepend(element);
}
note('system-files-card', 'Supply your own keys and firmware dumped from your own console. NX-Web does not include or download them. Most homebrew needs neither. Files stay in this browser.');
note('save-state-card', 'Slots copy in-game save files, not emulator save states. Select a slot in the player bar. Loading restarts the game. Export important saves as backups.');
function releaseInput() { window.dispatchEvent(new Event('nx-release-input')); }
function openSettings() { releaseInput(); if (shortcuts.open) shortcuts.close(); if (!drawer.open) drawer.showModal(); }
function openShortcuts() { releaseInput(); renderShortcuts(); if (drawer.open) drawer.close(); if (!shortcuts.open) shortcuts.showModal(); }
$('library-settings').addEventListener('click', openSettings);
$('player-settings').addEventListener('click', openSettings);
$('close-settings').addEventListener('click', () => drawer.close());
$('shortcut-hint').addEventListener('click', openShortcuts);
$('close-shortcuts').addEventListener('click', () => shortcuts.close());
for (const dialog of [drawer, shortcuts]) dialog.addEventListener('click', event => {
  if (event.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
});

let bindings = readBindings();
let rebinding = null;
const bindingButtons = new Map();
const bindingsCard = document.createElement('div'); bindingsCard.className = 'card';
bindingsCard.innerHTML = '<div class="bindings-heading"><h2>Keyboard</h2><button id="reset-bindings" class="text-button">Reset to defaults</button></div><p class="mode-help">Click a key to rebind it. Press Escape to cancel.</p><p id="binding-status" role="status" class="mode-help"></p><div id="binding-list"></div>';
$('panel-controls').prepend(bindingsCard);
function buildBindings() {
  for (const hotkey of [false, true]) {
    const heading = document.createElement('h3'); heading.textContent = hotkey ? 'Emulator' : 'Controller'; $('binding-list').append(heading);
    for (const action of ACTIONS.filter(action => Boolean(action.hotkey) === hotkey)) {
      const row = document.createElement('div'); row.className = 'binding-row';
      const label = document.createElement('span'); label.textContent = action.label;
      const button = document.createElement('button'); button.className = 'key-binding'; button.dataset.binding = action.id;
      bindingButtons.set(action.id, button);
      button.addEventListener('click', () => {
        releaseInput(); rebinding = action.id;
        renderBindings();
        $('binding-status').textContent = `New key for ${action.label}. Escape cancels.`;
      });
      row.append(label, button); $('binding-list').append(row);
    }
  }
}
function renderBindings() {
  for (const action of ACTIONS) {
    const button = bindingButtons.get(action.id);
    const listening = rebinding === action.id;
    button.classList.toggle('listening', listening);
    button.textContent = listening ? 'Press a key…' : keyLabel(bindings[action.id]);
    button.setAttribute('aria-label', `Rebind ${action.label}: ${button.textContent}`);
  }
  refreshHints();
}
function refreshHints() {
  const prompt = document.querySelector('#drop-zone .drop-prompt p');
  if (prompt) { const key = document.createElement('kbd'); key.textContent = keyLabel(bindings.open); prompt.replaceChildren('or press ',key,' to open'); }
  $('shortcut-hint').querySelector('kbd').textContent = keyLabel(bindings.shortcuts);
  for (const [id, action, label] of [['toggle-pause','pause','Pause / Resume'],['btn-save-state','save','Save slot'],['btn-load-slot','load','Load slot'],['player-fullscreen','fullscreen','Fullscreen'],['player-settings','settings','Settings'],['library-settings','settings','Settings']]) {
    $(id).title = `${label} (${keyLabel(bindings[action])})`;
  }
}
function renderShortcuts() {
  $('shortcuts-columns').replaceChildren();
  for (const hotkey of [false, true]) {
    const column = document.createElement('section'); const heading = document.createElement('h3');
    heading.textContent = hotkey ? 'Emulator' : 'Controller'; column.append(heading);
    const rows = hotkey ? ACTIONS.filter(action => action.hotkey).map(action => [action.label, [action.id]]) : [
      ['Left stick', ['leftUp','leftLeft','leftDown','leftRight']],
      ['Right stick', ['rightUp','rightLeft','rightDown','rightRight']],
      ['D-pad', ['dpadUp','dpadLeft','dpadDown','dpadRight']],
      ['A / B / X / Y', ['a','b','x','y']],
      ['L / R', ['l','r']], ['ZL / ZR', ['zl','zr']],
      ['Plus / Minus', ['plus','minus']], ['L3 / R3', ['l3','r3']], ['Home', ['home']],
    ];
    const shortcuts = rows.map(([name, ids]) => [name, ids.map(id => keyLabel(bindings[id]))]);
    if (hotkey) shortcuts.push(
      ['Stage fullscreen', ['Alt+Enter']],
      ['Picture-in-picture', ['Alt+P']],
      ['Toggle speed limit', ['Alt+U']],
    );
    for (const [name, labels] of shortcuts) {
      const row = document.createElement('div'); row.className = 'cheat-row';
      const label = document.createElement('span'); label.textContent = name;
      const keys = document.createElement('span'); keys.className = 'cheat-keys';
      for (const label of labels) { const key = document.createElement('kbd'); key.textContent = label; keys.append(key); }
      row.append(label, keys); column.append(row);
    }
    $('shortcuts-columns').append(column);
  }
}
$('reset-bindings').addEventListener('click', () => {
  bindings = { ...DEFAULT_BINDINGS }; rebinding = null;
  const stored = writeBindings(bindings); renderBindings(); $('binding-status').textContent = stored ? 'Default mappings restored.' : 'Defaults restored for this session. Browser storage is unavailable.';
});
drawer.addEventListener('close', () => { rebinding = null; renderBindings(); $('binding-status').textContent = ''; });
buildBindings();
renderBindings();

$('library-drop').append($('drop-zone'));
$('drop-zone').querySelector('.upload-art').remove();
$('drop-zone').querySelector('h2').textContent = 'Drop a game here';
refreshHints();
$('browse-btn').innerHTML = `${icon('open')}<span>Open game</span>`;
const formats = document.createElement('span'); formats.className = 'formats'; formats.textContent = '.nro / .nsp / .xci / archives'; $('drop-zone').querySelector('.drop-prompt').append(formats);
$('launch-status').append($('rom-status')); $('rom-status').textContent = '';
$('player-stage').append($('screen-stage')); $('player-title').append($('title-name')); $('player-fps').append($('fps-counter'));
for (const id of ['save-state-slot', 'btn-save-state', 'btn-load-slot']) $('toolbar-slot').append($(id));
for (const [id, name, label] of [['btn-save-state','save','Save slot'],['btn-load-slot','load','Load slot']]) {
  $(id).className = 'icon-button'; $(id).innerHTML = icon(name); $(id).setAttribute('aria-label', label);
}
$('save-state-slot').setAttribute('aria-label', 'Save slot');
$('canvas').tabIndex = 0;
$('show-joycons').closest('label').hidden = true;
document.querySelectorAll('.joycon').forEach(node => node.remove());
$('back-library').addEventListener('click', () => {
  if (confirm('Return to the library and stop this game? In-game saves already written to storage are kept.')) location.href = location.pathname;
});
$('player-fullscreen').addEventListener('click', () => {
  const action = document.fullscreenElement ? document.exitFullscreen() : $('player').requestFullscreen();
  action?.catch(() => { $('player-message').textContent = 'Fullscreen is unavailable in this browser.'; $('player-message').hidden = false; });
});
$('toggle-pause').addEventListener('click', () => ($('wasm-state').textContent === 'Paused' ? $('btn-play') : $('btn-pause')).click());
function updateState() {
  const state = $('wasm-state').textContent;
  const problem = runtimeProblem(state);
  $('runtime-problem').hidden = !problem;
  $('runtime-problem').textContent = problem;
  if (['Booting','Running','Paused','Failed','Crashed','Stopped'].includes(state)) {
    $('library').hidden = true; $('player').hidden = false; document.body.classList.add('playing');
  }
  const paused = state === 'Paused';
  const label = paused ? 'Resume' : 'Pause';
  if ($('toggle-pause').getAttribute('aria-label') !== label) {
    $('toggle-pause').innerHTML = icon(paused ? 'play' : 'pause'); $('toggle-pause').setAttribute('aria-label', label);
  }
  $('toggle-pause').disabled = !['Running','Paused'].includes(state);
  $('player-message').hidden = ['Running','Paused'].includes(state);
  $('player-message').textContent = ['Failed','Crashed'].includes(state) ? $('rom-status').textContent : `${state}…`;
  if (state !== previousState) { previousState = state; showBar(); }
}
let previousState;
new MutationObserver(updateState).observe($('wasm-state'), { childList:true, subtree:true });
new MutationObserver(updateState).observe($('rom-status'), { childList:true, subtree:true });
let barTimer;
function showBar() {
  document.body.classList.remove('bar-hidden'); clearTimeout(barTimer);
  if ($('wasm-state').textContent === 'Running') barTimer = setTimeout(() => {
    if (!drawer.open && !shortcuts.open && !$('player-toolbar').contains(document.activeElement)) document.body.classList.add('bar-hidden');
  }, 2000);
}
$('player').addEventListener('pointermove', showBar);
$('player').addEventListener('touchstart', showBar, { passive:true });
$('player-toolbar').addEventListener('focusin', showBar);
$('player-toolbar').addEventListener('click', event => { if (event.target.tagName !== 'SELECT' && !drawer.open) $('canvas').focus(); });
for (const dialog of [drawer, shortcuts]) dialog.addEventListener('close', () => {
  if (!$('player').hidden && !drawer.open && !shortcuts.open) { $('canvas').focus(); showBar(); }
});
function hotkey(action) {
  const playing = !$('player').hidden;
  if (action === 'open' && !playing) $('file-input').click();
  else if (action === 'settings') drawer.open ? drawer.close() : openSettings();
  else if (action === 'shortcuts') shortcuts.open ? shortcuts.close() : openShortcuts();
  else if (action === 'bar') { if (shortcuts.open) shortcuts.close(); else if (drawer.open) drawer.close(); showBar(); }
  else if (playing) ({ pause:$('toggle-pause'), save:$('btn-save-state'), load:$('btn-load-slot'), fullscreen:$('player-fullscreen') })[action]?.click();
}
window.addEventListener('keydown', event => {
  if (rebinding) {
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.repeat || event.key === 'Shift') return;
    if (event.code === 'Escape') { rebinding = null; renderBindings(); $('binding-status').textContent = 'Rebinding cancelled.'; return; }
    try {
      if (event.ctrlKey || event.altKey || event.metaKey) throw new Error('Choose a single key, optionally with Shift.');
      bindings = rebind(bindings, rebinding, bindingKey(event));
      const stored = writeBindings(bindings); rebinding = null; renderBindings();
      $('binding-status').textContent = stored ? 'Mapping saved.' : 'Mapping changed for this session. Browser storage is unavailable.';
    } catch (error) { $('binding-status').textContent = error.message; }
    return;
  }
  if (event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
  const modalOpen = drawer.open || shortcuts.open;
  if (modalOpen && event.code === 'Tab') return;
  if ($('settings-tabs').contains(event.target) && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  if (usesNativeKeys(event)) return;
  const action = ACTIONS.find(action => action.hotkey && bindings[action.id] === bindingKey(event));
  if (!action) return;
  if (action.id === 'open' ? modalOpen || $('library').hidden
    : !['bar', 'settings', 'shortcuts'].includes(action.id) && (modalOpen || $('player').hidden)) return;
  event.preventDefault(); event.stopImmediatePropagation();
  if (!event.repeat) hotkey(action.id);
}, true);

let recent = [];
try { recent = recentGames(localStorage.getItem('nx-recent')); } catch {}
function renderRecent() {
  $('recent-games').replaceChildren(); $('recent-section').hidden = !recent.length;
  for (const file of recent) {
    const row = document.createElement('button'); row.className = 'recent-game'; row.innerHTML = icon('game');
    row.title = 'Choose this file again to reopen. Game files are not stored in the recent list.';
    const name = document.createElement('strong'); name.textContent = file.name;
    const size = document.createElement('span'); size.textContent = `${(file.size / 1024 ** 2).toFixed(1)} MB`;
    row.append(name, size); row.addEventListener('click', () => { $('rom-status').textContent = `Choose ${file.name} again to reopen it. NX-Web doesn't keep copies of your games.`; $('file-input').click(); }); $('recent-games').append(row);
  }
}
function saveRecent() { try { localStorage.setItem('nx-recent', JSON.stringify(recent)); } catch {} renderRecent(); }
let chosen = null;
function remember(file) { if (file && /\.(nro|nsp|xci|zip|7z|rar|tar|tgz|gz|bz2|xz|zst)$/i.test(file.name)) { recent = rememberGame(recent,file); saveRecent(); } }
$('file-input').addEventListener('change', () => { chosen = $('file-input').files[0]; });
$('drop-zone').addEventListener('drop', event => { chosen = event.dataTransfer.files[0]; });
new MutationObserver(() => { if (chosen && ['Booting','Running'].includes($('wasm-state').textContent)) { remember(chosen); chosen = null; } }).observe($('wasm-state'), { childList:true, subtree:true });
window.addEventListener('dragover', event => {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = $('library').hidden ? 'none' : 'copy';
});
window.addEventListener('drop', event => {
  event.preventDefault();
  if ($('library').hidden || $('drop-zone').contains(event.target) || !event.dataTransfer?.files.length) return;
  $('drop-zone').dispatchEvent(new DragEvent('drop', { dataTransfer:event.dataTransfer, bubbles:true, cancelable:true }));
});
$('clear-recent').addEventListener('click', () => { recent = []; saveRecent(); }); renderRecent();
runPreflight().then(({checks}) => {
  const problems = compatibilityProblems(checks); $('compatibility-problems').hidden = !problems.length;
  if (!problems.length) return;
  const heading = document.createElement('strong'); heading.textContent = "This browser can't run games yet";
  const list = document.createElement('ul');
  for (const problem of problems) { const item = document.createElement('li'); item.textContent = `${problem.label}: ${problem.help || problem.value}`; list.append(item); }
  $('compatibility-problems').replaceChildren(heading, list);
}).catch(() => { $('compatibility-problems').hidden = false; $('compatibility-problems').textContent = 'Browser check unavailable. Use recent Chrome with WebGPU and COOP/COEP isolation over HTTPS or localhost.'; });
const cleanLabels = () => {
  for (const node of document.querySelectorAll('#settings-panels button, #settings-panels h2, #settings-panels h3')) {
    for (const child of node.childNodes) if (child.nodeType === Node.TEXT_NODE) {
      const clean = child.textContent.replace(/[\p{Extended_Pictographic}\uFE0F]/gu,'').trimStart();
      if (clean !== child.textContent) child.textContent = clean;
    }
  }
};
new MutationObserver(cleanLabels).observe($('settings-panels'), { childList:true, subtree:true }); cleanLabels();
try { await import('./app.js'); } catch (error) {
  $('launch-status').textContent = `Could not start NX-Web: ${error.message}. Reload the page; see Settings → Diagnostics if this persists.`; console.error(error);
}
