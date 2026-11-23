// SPDX-License-Identifier: GPL-3.0-or-later
// ROM_PATHS=/path/hello.nro,/path/graphics.nro LAUNCHES=30 MODE=same-tab node tests/repeat_launch_browser.mjs
// MODE=new-tab closes each old tab. Both modes retain the same on-disk Chrome profile.
// Reuse PROFILE_DIR and PORT across runs; CLEAR_STORAGE explicitly deletes only the named kind.
// Opt-in SCENARIO: concurrent (CONCURRENT_STAGE=running|booting), close-boot,
// navigate-boot, runtime-touch (changes local runtime mtimes/manifest), guest-exit, guest-crash, boot-stall.
// SAVE_COUNTER_KEY=sdmc/nxweb-counter.txt verifies a homebrew increments its persisted counter each launch.
// RECOVER=1 records a failure, restarts only the server, then Chrome with the same profile.
// REQUIRE_FRAME_PROGRESS=1 checks the dwell window too; CONTINUE_ON_FAILURE=1 tests remaining ROMs.
// GUEST_AUTO_RESTART=1 leaves the UI's automatic crash recovery enabled for guest-exit.
import assert from 'node:assert/strict';
import { mkdir, writeFile, stat, utimes } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import { createServer } from '../scripts/serve.mjs';

const roms = (process.env.ROM_PATHS ?? process.env.ROM_PATH ?? '').split(',').filter(Boolean).map(p => path.resolve(p));
assert.ok(roms.length, 'Set ROM_PATHS to freely redistributable homebrew files');
for (const rom of roms) assert.ok((await stat(rom)).isFile(), `Not a file: ${rom}`);
const launches = Number(process.env.LAUNCHES ?? 20);
const timeout = Number(process.env.BOOT_TIMEOUT_MS ?? 120_000);
const dwell = Number(process.env.DWELL_MS ?? 5000);
const mode = process.env.MODE ?? 'same-tab';
const scenario = process.env.SCENARIO ?? 'sequential';
assert.ok(['sequential', 'concurrent', 'close-boot', 'navigate-boot', 'runtime-touch', 'guest-exit', 'guest-crash', 'boot-stall'].includes(scenario), 'Invalid SCENARIO');
const recover = process.env.RECOVER === '1';
assert.ok(['same-tab', 'new-tab'].includes(mode), 'MODE must be same-tab or new-tab');
assert.ok(Number.isInteger(launches) && launches > 0);
assert.ok(Number.isFinite(timeout) && timeout > 0);
assert.ok(Number.isFinite(dwell) && dwell >= 0);
const clear = process.env.CLEAR_STORAGE;
assert.ok(!clear || ['opfs', 'indexeddb', 'cache_storage', 'local_storage'].includes(clear), 'Invalid CLEAR_STORAGE');
const profile = path.resolve(process.env.PROFILE_DIR ?? `${process.env.HOME}/repeat-launch-profile`);
const report = path.resolve(process.env.REPORT_PATH ?? `${process.env.HOME}/repeat-launch-${Date.now()}.json`);
await mkdir(profile, { recursive: true });
const server = createServer();
await new Promise(resolve => server.listen(Number(process.env.PORT ?? 8089), '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const results = [];
const events = [];
let baseline;
let browserVersion;
let launch = 0;
let nextPageId = 0;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function memory() {
  const cdp = await browser.target().createCDPSession();
  try {
    const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
    const rss = new Map(execFileSync('ps', ['-eo', 'pid=,rss='], { encoding: 'utf8' }).trim().split('\n')
      .map(line => line.trim().split(/\s+/).map(Number)));
    return processInfo.map(p => ({ ...p, rssKiB: rss.get(p.id) ?? null }));
  } finally { await cdp.detach(); }
}
async function ui(page) {
  return page.evaluate(() => ({
    state: document.querySelector('#wasm-state')?.textContent,
    fps: document.querySelector('#fps-counter')?.textContent,
    status: document.querySelector('#wasm-status-text')?.textContent,
    romStatus: document.querySelector('#rom-status')?.textContent,
    sessionNotice: document.querySelector('#session-lock')?.textContent,
    inert: document.querySelector('#nx-app')?.inert,
    frames: document.querySelector('#engine-frames')?.textContent,
    heap: document.querySelector('#engine-heap')?.textContent,
    gpuCalls: window.__repeatLaunchGpu,
  }));
}
async function select(page, rom, waitForSession = true) {
  await page.waitForSelector('#file-input', { timeout });
  if (waitForSession) await page.waitForFunction(() => document.querySelector('#nx-app')?.inert === false, { timeout });
  await (await page.$('#file-input')).uploadFile(rom);
}
async function frames(page) {
  await page.waitForFunction(() => document.querySelector('#wasm-state')?.textContent === 'Running'
    && parseFloat(document.querySelector('#fps-counter')?.textContent) > 0, { timeout });
}
async function restartServer() {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await new Promise(resolve => server.listen(Number(new URL(origin).port), '127.0.0.1', resolve));
}
async function openPage() {
  const page = await browser.newPage();
  await instrument(page);
  observe(page);
  await page.goto(origin);
  return page;
}
async function instrument(page) {
  await page.evaluateOnNewDocument(() => {
    if (new URLSearchParams(location.search).get('bootTimeoutMs') === '50' && navigator.gpu) {
      navigator.gpu.requestAdapter = () => new Promise(() => {});
    }
    window.__repeatLaunchGpu = [];
    for (const [target, name] of [[navigator.gpu, 'requestAdapter'], [globalThis.GPUAdapter?.prototype, 'requestDevice']]) {
      if (!target?.[name]) continue;
      const original = target[name];
      target[name] = function (...args) {
        const call = { name, start: performance.now(), state: 'pending' };
        window.__repeatLaunchGpu.push(call);
        return original.apply(this, args).then(value => {
          call.state = value ? 'resolved' : 'null';
          call.end = performance.now();
          return value;
        }, error => {
          call.state = 'rejected'; call.error = error.message; call.end = performance.now();
          throw error;
        });
      };
    }
  });
}
async function storage(page) {
  return page.evaluate(async () => {
    const request = req => new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tree = [];
    async function walk(dir, prefix = '') {
      for await (const [name, handle] of dir.entries()) {
        const path = `${prefix}/${name}`;
        if (handle.kind === 'directory') await walk(handle, path);
        else tree.push({ path, bytes: (await handle.getFile()).size });
      }
    }
    await walk(await navigator.storage.getDirectory());
    const databases = [];
    for (const info of await indexedDB.databases()) {
      const db = await request(indexedDB.open(info.name));
      try {
        const stores = [];
        for (const name of db.objectStoreNames) {
          const store = db.transaction(name).objectStore(name);
          const [keys, values] = await Promise.all([request(store.getAllKeys()), request(store.getAll())]);
          stores.push({ name, records: keys.map((key, i) => ({ key, bytes: values[i]?.size ?? null,
            kind: values[i]?.kind ?? typeof values[i] })) });
        }
        databases.push({ ...info, stores });
      } finally { db.close(); }
    }
    return { estimate: await navigator.storage.estimate(), opfs: tree, databases,
      caches: await caches.keys(), localStorageKeys: Object.keys(localStorage),
      sessionStorageKeys: Object.keys(sessionStorage), locks: await navigator.locks.query() };
  });
}
function observe(page) {
  const pageId = ++nextPageId;
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) events.push({ launch, pageId, type: 'navigation', url: frame.url(), time: Date.now() });
  });
  page.on('response', response => {
    if (/\/runtime\/|coi-serviceworker/.test(response.url())) events.push({ launch, pageId, type: 'response',
      url: response.url(), status: response.status(), headers: response.headers(),
      fromCache: response.fromCache(), fromServiceWorker: response.fromServiceWorker(), time: Date.now() });
  });
  page.on('console', message => events.push({ launch, pageId, type: message.type(), text: message.text(), time: Date.now() }));
  page.on('pageerror', error => events.push({ launch, pageId, type: 'pageerror', text: error.message, time: Date.now() }));
  page.on('error', error => events.push({ launch, pageId, type: 'crash', text: error.message, time: Date.now() }));
  page.on('workercreated', worker => events.push({ launch, pageId, type: 'workercreated', text: worker.url(), time: Date.now() }));
  page.on('workerdestroyed', worker => events.push({ launch, pageId, type: 'workerdestroyed', text: worker.url(), time: Date.now() }));
}
async function save() {
  await writeFile(report, JSON.stringify({ profile, origin, mode, scenario, recover, roms, clear, dwell, browserVersion, baseline, results, events }, null, 2));
}
async function startBrowser() {
  return puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? execFileSync('which', ['google-chrome'], { encoding: 'utf8' }).trim(),
    userDataDir: profile, headless: false, protocolTimeout: timeout + 30_000,
    env: { ...process.env, DISPLAY: process.env.DISPLAY ?? ':0', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus' },
    args: ['--no-sandbox', '--enable-unsafe-webgpu',
      '--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan,WebAssemblyMemory64',
      '--use-angle=swiftshader', '--disable-vulkan-surface', '--enable-dawn-features=allow_unsafe_apis'] });
}
try {
  browser = await startBrowser();
  let page = await browser.newPage();
  await instrument(page);
  browserVersion = await browser.version();
  observe(page);
  await page.goto(origin);
  if (clear) {
    // Navigate away first so no emulator or open database connection can race deletion.
    await page.goto(`${origin}/version.json`);
    if (clear === 'opfs') await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      for await (const name of root.keys()) await root.removeEntry(name, { recursive: true });
    });
    else {
      const cdp = await page.createCDPSession();
      await cdp.send('Storage.clearDataForOrigin', { origin, storageTypes: clear });
      await cdp.detach();
    }
    await page.goto(origin);
  }
  console.log(`Profile: ${profile}\nReport: ${report}\nOrigin: ${origin}`);
  baseline = await storage(page);
  console.log('| Launch | Mode | ROM | Result | State | FPS | ms | Usage bytes | OPFS bytes |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (launch = 1; launch <= launches; launch++) {
    const rom = roms[(launch - 1) % roms.length];
    const start = Date.now();
    const row = { launch, mode, rom, result: 'error' };
    let sampler;
    try {
      if (launch > 1) {
        if (mode === 'new-tab') {
          await page.close();
          page = await browser.newPage();
          await instrument(page);
          observe(page);
          await page.goto(origin);
        } else {
          // The library's Leave Game action performs this full-document navigation.
          await page.goto(origin);
        }
      }
      row.memory = [{ time: Date.now(), processes: await memory() }];
      let sampling = false;
      sampler = setInterval(async () => {
        if (sampling) return;
        sampling = true;
        try { row.memory.push({ time: Date.now(), processes: await memory() }); }
        catch (error) { events.push({ launch, type: 'memory-error', text: error.message }); }
        finally { sampling = false; }
      }, 5000);
      if (['guest-exit', 'guest-crash'].includes(scenario) && process.env.GUEST_AUTO_RESTART !== '1') {
        await page.$eval('#auto-restart', el => { el.checked = false; });
      }
      if (scenario === 'boot-stall') await page.goto(`${origin}/?bootTimeoutMs=50&retryProbe=preserved`);
      await select(page, rom);
      if (scenario === 'boot-stall') {
        await page.waitForSelector('#boot-reload', { visible: true, timeout });
        row.stuckBoot = await ui(page);
        assert.equal(row.stuckBoot.state, 'Stuck');
        assert.match(row.stuckBoot.romStatus, /Boot appears stuck/);
        await Promise.all([page.waitForNavigation(), page.click('#boot-reload')]);
        assert.equal(new URL(page.url()).searchParams.has('bootTimeoutMs'), false, 'retry removes the test timeout');
        assert.equal(new URL(page.url()).searchParams.get('retryProbe'), 'preserved', 'retry preserves other query parameters');
        await frames(page);
        row.bootRecovery = await ui(page);
      }
      if (['close-boot', 'navigate-boot'].includes(scenario)) {
        await page.waitForFunction(() => document.querySelector('#wasm-state')?.textContent === 'Booting', { polling: 10, timeout });
        row.interrupted = { ui: await ui(page), storage: await storage(page) };
        if (scenario === 'close-boot') {
          await page.close();
          page = await openPage();
        } else await page.goto(origin);
        await select(page, rom);
      }
      if (scenario === 'concurrent') {
        if (process.env.CONCURRENT_STAGE === 'booting') {
          await page.waitForFunction(() => document.querySelector('#wasm-state')?.textContent === 'Booting', { polling: 10, timeout });
        } else await frames(page);
        row.ownerAtProbeOpen = await ui(page);
        const owner = page;
        const probe = await openPage();
        await probe.waitForFunction(() => document.querySelector('#session-lock')?.textContent.includes('already open'), { timeout });
        await select(probe, rom, false);
        if (roms.length > 1) await select(probe, roms[launch % roms.length], false);
        await pause(1000);
        row.blockedProbe = { ui: await ui(probe), storage: await storage(probe) };
        await restartServer();
        row.blockedAfterServerRestart = { ui: await ui(probe), storage: await storage(probe) };
        await owner.close();
        await frames(probe);
        const expectedRom = roms.length > 1 ? roms[launch % roms.length] : rom;
        assert.match((await ui(probe)).romStatus, new RegExp(path.basename(expectedRom).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        row.probeAfterOwnerClosed = { ui: await ui(probe), storage: await storage(probe) };
        row.automaticLaunch = true;
        page = probe;
      }
      try {
        await frames(page);
        row.result = 'running-frames';
        row.firstFrames = (await ui(page)).frames;
        await pause(dwell);
      } catch (error) {
        row.error = error.message;
        row.result = 'timeout';
      }
      Object.assign(row, await ui(page));
      if (process.env.REQUIRE_FRAME_PROGRESS === '1' && row.result === 'running-frames'
        && !(Number(row.frames) > Number(row.firstFrames))) row.result = 'stalled-frames';
      if (['guest-exit', 'guest-crash'].includes(scenario) && row.result === 'running-frames') {
        const exitEventStart = events.length;
        await page.bringToFront();
        await page.evaluate(() => { document.activeElement?.blur(); });
        await page.keyboard.down(process.env.EXIT_KEY ?? 'Enter');
        await pause(200);
        await page.keyboard.up(process.env.EXIT_KEY ?? 'Enter');
        const expectedState = scenario === 'guest-exit' ? 'Exited' : 'Crashed';
        await page.waitForFunction(expected => document.querySelector('#wasm-state')?.textContent === expected, { timeout }, expectedState);
        await pause(Number(process.env.EXIT_WAIT_MS ?? 1000));
        row.afterGuestExit = { ui: await ui(page), storage: await storage(page) };
        assert.equal(row.afterGuestExit.ui.state, expectedState);
        const exitErrors = events.slice(exitEventStart).filter(event =>
          /ExceptionRaised|<Critical>|assertion failed|Game crashed|Restarting .*after a crash/i.test(event.text ?? ''));
        if (scenario === 'guest-exit') {
          assert.deepEqual(exitErrors, [], 'normal guest exit must not enter crash handling');
          assert.ok(!row.afterGuestExit.storage.opfs.some(file => file.path.includes('crash-resume')), 'normal exit must not stash a crash resume');
          row.exitResult = 'clean-exit';
        } else {
          assert.ok(exitErrors.some(event => /Game crashed/.test(event.text)), 'guest fault must reach onCrash');
          row.exitResult = 'crash-handled';
        }
        await Promise.all([page.waitForNavigation(), page.click('#back-library')]);
        await select(page, roms[launch % roms.length]);
        await frames(page);
        row.nextLaunch = await ui(page);
      }
      if (scenario === 'runtime-touch' && row.result === 'running-frames') {
        const now = new Date();
        for (const name of ['eden.js', 'eden.wasm']) await utimes(new URL(`../web/runtime/${name}`, import.meta.url), now, now);
        execFileSync(process.execPath, [new URL('../scripts/runtime-manifest.mjs', import.meta.url).pathname]);
        row.runtimeTouched = now.toISOString();
      }
      if (row.result === 'timeout' && row.state === 'Booting') row.result = 'stuck-booting';
      row.storage = await storage(page);
      if (process.env.SAVE_COUNTER_KEY) {
        row.saveCounter = await page.evaluate(async key => {
          const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open('eden-recovery');
            request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
          });
          try {
            const value = await new Promise((resolve, reject) => {
              const request = db.transaction('saves').objectStore('saves').get(key);
              request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
            });
            return Number(await value?.text());
          } finally { db.close(); }
        }, process.env.SAVE_COUNTER_KEY);
        assert.ok(Number.isFinite(row.saveCounter), 'counter must have reached IndexedDB');
        if (results.length) assert.equal(row.saveCounter, results.at(-1).saveCounter + 1, 'each launch must restore and increment the saved counter');
      }
      row.metrics = await page.metrics();
      row.workers = page.workers().map(w => w.url());
      row.memory.push({ time: Date.now(), processes: await memory() });
    } catch (error) {
      row.result = 'error';
      row.error = error.stack;
      try { Object.assign(row, await ui(page)); row.storage = await storage(page); } catch {}
    } finally { clearInterval(sampler); }
    if (recover && row.result !== 'running-frames') {
      // Save the untouched failure before trying any recovery; never clear storage here.
      results.push(row);
      await save();
      row.recovery = [];
      await restartServer();
      await pause(3000);
      row.recovery.push({ action: 'server-only-no-navigation', ui: await ui(page), storage: await storage(page) });
      await page.goto(origin);
      try {
        await select(page, rom);
        await frames(page);
        row.recovery.push({ action: 'navigation-after-server-restart', result: 'running-frames', ui: await ui(page), storage: await storage(page) });
      } catch (error) { row.recovery.push({ action: 'navigation-after-server-restart', error: error.message, ui: await ui(page), storage: await storage(page) }); }
      await browser.close();
      browser = await startBrowser();
      page = await openPage();
      try {
        await select(page, rom);
        await frames(page);
        row.recovery.push({ action: 'chrome-restart-same-profile', result: 'running-frames', ui: await ui(page), storage: await storage(page) });
      } catch (error) { row.recovery.push({ action: 'chrome-restart-same-profile', error: error.message, ui: await ui(page), storage: await storage(page) }); }
      if (process.env.CONTROL_ROM_PATH) {
        await page.goto(origin);
        try {
          await select(page, path.resolve(process.env.CONTROL_ROM_PATH));
          await frames(page);
          row.recovery.push({ action: 'control-rom-same-profile', result: 'running-frames', ui: await ui(page) });
        } catch (error) { row.recovery.push({ action: 'control-rom-same-profile', error: error.message, ui: await ui(page) }); }
      }
    }
    row.ms = Date.now() - start;
    if (results.at(-1) !== row) results.push(row);
    await save();
    console.log(`| ${launch} | ${mode} | ${path.basename(rom)} | ${row.result} | ${row.state ?? '-'} | ${row.fps ?? '-'} | ${row.ms} | ${row.storage?.estimate.usage ?? '-'} | ${row.storage?.opfs.reduce((sum, f) => sum + f.bytes, 0) ?? '-'} |`);
    if (['guest-exit', 'guest-crash'].includes(scenario)) console.log(`Guest exit ${launch}: ${row.exitResult ?? 'failed'}; next launch: ${row.nextLaunch?.state ?? 'not reached'}`);
    if (scenario === 'concurrent') console.log(`Automatic probe launch ${launch}: ${row.automaticLaunch ? 'Running' : 'failed'}`);
    if (scenario === 'boot-stall') console.log(`Boot watchdog ${launch}: ${row.stuckBoot?.state ?? 'failed'} -> Reload -> ${row.bootRecovery?.state ?? 'failed'}`);
    if (process.env.SAVE_COUNTER_KEY) console.log(`Save counter ${launch}: ${row.saveCounter}`);
    if (row.result !== 'running-frames') {
      process.exitCode = 1;
      if (process.env.CONTINUE_ON_FAILURE !== '1') break;
    }
  }
} finally {
  await save();
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
