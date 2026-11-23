# NX-Web

A minimal, local-first Nintendo Switch emulator for the browser. Powered by the
Eden WebAssembly port: a Wasm JIT / IR interpreter, WebGPU renderer, audio,
keyboard and gamepad input, persistent saves, and worker-backed ROM reads.

**Experimental.** Simple libnx homebrew has been tested locally. Commercial-game
compatibility, stability and performance are not guaranteed. This is not affiliated
with Nintendo. The UI has no account, upload service, analytics or game catalogue.

## Requirements

- Recent desktop Chrome / Chromium with WebGPU, WebAssembly Memory64 **with shared
  memory**, SIMD and exception handling. Memory64 is mandatory, not a WebGL fallback.
- HTTPS or localhost, with `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp` so pthreads / SharedArrayBuffer work.
  The included server sends both. A static-hosting service worker is also retained;
  first visits to hosts without headers may need a reload.
- Several GB of free RAM and browser storage; a hardware WebGPU adapter is strongly
  recommended. Software adapters are useful for homebrew testing, not performance
  claims. Other browsers and mobile devices are not validated.
- Node 24+ and npm for frontend development / tests. An engine build additionally
  requires Linux build tools, CMake 3.31+, Ninja, Python 3 + pip, Git, curl, patch,
  Perl, pkg-config and `glslangValidator`.

## Build and run

```sh
git clone --recurse-submodules https://github.com/Katsugachi/NX-Web.git
cd NX-Web
npm ci
# Ubuntu engine prerequisites:
sudo apt install build-essential ninja-build glslang-tools python3-pip curl patch perl pkg-config
npm run build:engine
npm run dev
```

Open **http://127.0.0.1:8080**. Override the port with `PORT=8081 npm run dev`.
The server binds localhost only; use a suitably configured HTTPS server for hosting.

`engine/` is a submodule pinned to **d358e857c49d26b078acfb6c4273d732d77904d3**
of [Shubin123/eden_emscripten](https://github.com/Shubin123/eden_emscripten).
`scripts/build-engine.sh` installs/activates Emscripten **7.0.1** under `~/emsdk`
(override with `EMSDK` / `EMSDK_VERSION`), installs user-local CMake 4.4.5 if the
current version is too old, configures the engine, applies the tracked engine/dependency
patches, and builds the engine and archive decoder. Set `EDEN_BUILD_JOBS=8` to change
the default four parallel jobs. Expect substantial downloads, disk use and build time.

Patches in `engine-patches/` add Sirit's missing `<cstdlib>` and an Emscripten-only
ReShade `<alloca.h>`, and connect the browser's default player-one Pro Controller.
Both already-applied and fresh-cache states are supported;
unexpected dependency changes fail clearly instead of silently skipping patches.
The controller source patch is reversed on exit if the script applied it; the engine
submodule revision stays pinned. All `eden*.js` / `eden*.wasm` outputs and a
checksum manifest are copied into **gitignored `web/runtime/`**. Build again after
updating the submodule. Do not change the engine revision without revalidating it.

If you already built this exact engine revision in a sibling checkout, its release
`build-web/bin/eden*.js` and `eden*.wasm` can be copied into `web/runtime/`; then run
`node scripts/runtime-manifest.mjs`. Runtime binaries are deliberately not in Git.
Missing-runtime errors mean the frontend is installed but the engine still needs building.

## Use

Drop a `.nro`, legally obtained `.nsp` / `.xci`, or archive onto the landing card,
or press **O** to open a file. ZIP and the engine's libarchive-supported formats are
handled locally. Recent tiles store names and sizes only; reopening asks you to
choose the file again. No game cover art or game files are shipped.

For a ZIP with a single homebrew NRO, NX-Web also loads assets from its
`switch/<app>/` folder onto the virtual SD card. Put the NRO in that folder
or name it `<app>.nro` at the ZIP root. Existing SD saves take priority;
unchanged bundled files are mounted each launch, not copied into save backups.

While playing, move the mouse or press **Esc** to show the bar. It fades after two
idle seconds. **Tab** opens Settings, **?** shows the shortcut sheet. The canvas fits
the full viewport at 16:9. Every keyboard mapping can be changed in
**Settings → Controls** by clicking a key, and is saved in localStorage. Conflicting
bindings are rejected. Reset to defaults is available. Gamepads are detected
automatically (press a controller button to expose it to the browser).

| Controller | Default keys |
| --- | --- |
| Left stick | W / A / S / D |
| Right stick | T / F / G / H |
| D-pad | Arrow keys |
| A / B / X / Y | L / K / I / J |
| L / R / ZL / ZR | Q / O / E / U |
| Plus / Minus | Enter / Backspace |
| L3 / R3 / Home | C / N / Backquote |
| Motion pitch / yaw / roll | 1 / 2 · 3 / 4 · 5 / 6 |

| Emulator | Default key |
| --- | --- |
| Open game (library only) | O |
| Pause / Resume | P |
| Save / Load selected slot | F5 / F8 |
| Fullscreen | F11 |
| Settings | Tab |
| Show bar / close drawer | Esc |
| Shortcuts | ? |

Tab keeps its normal focus-navigation behavior inside dialogs. Escape also retains
the browser's native close-dialog behavior. Keyboard game input is released on
blur, rebinding, opening a dialog or focusing a form field so buttons cannot
remain stuck. Home is a system button, not an in-game controller input.

Motion controls feed the emulated Pro Controller. A phone or tablet can supply
motion and orientation on a secure origin; select **Enable device motion** under
**Settings → Controls** if your browser asks for permission. Gamepad motion works
only if the browser exposes a motion pose (standard desktop Chrome gamepads
don't). Hold a motion key to override player 1 sensors and simulate rotation;
pitch and roll also tilt the accelerometer. Release to return control to the
physical sensor or to rest.

Settings contains controls/gamepads, system-file import, graphics filtering and
fit, JIT/interpreter selection, speed limit, audio, saves and diagnostics. Changing
cores or system files after boot may require a reload. Only builds included in the
pinned engine are offered (not upstream's separate optional fused build).

**Slots are copies of in-game save files, not CPU/GPU snapshots.** Loading a slot
restarts the game. Games without a recognized title ID may not support slots.
In-game saves and imported system files use browser-local storage. Export important
saves as ZIP backups; clearing site data or browser eviction can erase them.
Diagnostics provides logs, copyable summaries and downloadable bundles. Review a
bundle for private information before sharing it.

## Homebrew validation

Build libnx examples using [devkitPro](https://devkitpro.org/), for example the
`devkitpro/devkita64` Docker image and its Switch console hello-world template and
`graphics/simplegfx` framebuffer example. Keep outputs **outside this repository**:

1. Build `hello-world.nro` and `simplegfx.nro` with the image's toolchain / Makefiles.
2. Start the local server and use the new UI's file picker to select each NRO.
3. Allow about 30 seconds each. Hello-world should show “Hello World!” on black;
   simplegfx should show its cycling grey framebuffer. Neither requires keys/firmware.
4. Check the FPS in the bar and logs under Diagnostics; capture screenshots and
   check for page exceptions, device loss and crashes, not just a “Running” label.

Top-level homebrew NRO loads enable process ASLR, as an hbloader application
process does on hardware. Other loaders retain their existing policy; the kernel
metadata-loading API still permits ASLR to be disabled. Old libnx releases (including
NXQuake v0.1.1's allocator) can otherwise select a thread-stack mapping that overlaps
the main stack: their free-space check compares against an entire `QueryMemory`
block's size rather than the space remaining after the queried address. The libnx
bounds check was fixed in [145ad1ba](https://github.com/switchbrew/libnx/commit/145ad1ba8740d9ba3d132d52229abb01b876276d).

To measure nonzero browser PCM, run the opt-in audio test against a running Chrome
with CDP enabled, using a legally obtained audio-producing homebrew NRO or ZIP:

```sh
ROM_PATH=/path/to/playtone.nro CDP_URL=http://127.0.0.1:9227 node tests/audio_browser.mjs
```

This test boots through the normal file-input/ZIP flow in a fresh browser context
and measures completed SDL3 ScriptProcessor output buffers before browser volume
and mute. It asserts callbacks and nonzero RMS, not physical speaker output.
`AUDIO_SECONDS` controls the recording window (default 60, maximum 300).
The probe reports first callback, first nonzero PCM, and first buffer with RMS at
least 0.0001, in milliseconds from file selection (including ZIP/mount time).
`AUDIO_REPORT=/path/report.json` saves PCM statistics, AudioContext state changes,
and timestamped console logs; `AUDIO_SCREENSHOT=/path/title.png` saves the final frame.
The probe presses A (keyboard `l`) after five seconds for interactive audio samples;
set `AUDIO_KEY` to another key, or to an empty string to send no input.
OpenTTD's bundled assets can take over 55 seconds to reach audible playback on software
rendering; allow 95 seconds rather than treating an earlier zero as an audio error.
For NXQuake with LibreQuake, use a known sound stimulus rather than relying on the
opening demo: add `switch/nxquake/id1/autoexec.cfg` to the local bundle containing
`volume 0.7`, `map start`, `wait`, and `play misc/menu1` on separate lines. This
exercises the original NRO's mixer and SDL callback without rebuilding the guest.
Keep the NROs, game assets, modified bundles and recordings outside the repository.

### OpenTTD bundled graphics

The OpenTTD ZIP is an external [Homebrew App Store package](https://switch.cdn.fortheusers.org/zips/OpenTTD.zip),
not an asset checked into this repository. Its `info.json` identifies rsn8887's
[Switch port v1.07](https://github.com/rsn8887/OpenTTD); `manifest.install` lists the
flat `switch/openttd/` layout. NX-Web mounts those files on the emulated SD card.

That package includes OpenGFX 0.5.2, whose extra-GRF GUI block supplies offsets
0–174. The bundled OpenTTD build expects 179 GUI sprites: the missing four are
`SPR_GROUP_LIVERY_TRAIN`, `SPR_GROUP_LIVERY_ROADVEH`, `SPR_GROUP_LIVERY_SHIP`, and
`SPR_GROUP_LIVERY_AIRCRAFT` (offsets 175–178 from `SPR_OPENTTD_BASE=4896`, IDs
5071–5074). OpenTTD supplies fallback graphics but warns about the outdated set.
Official OpenGFX 7.1 supplies these four in Action 5 type 0x15, offset 175, count 4.

Build an updated ZIP without changing the guest executable or importing separate
SD data (Python 3.9+, standard library only):

```sh
python3 scripts/bundle-openttd.py ~/Downloads/OpenTTD-opengfx-7.1.zip
# Or reuse the original downloads instead of downloading them again:
python3 scripts/bundle-openttd.py ~/Downloads/OpenTTD-updated.zip \
  --bundle ~/Downloads/OpenTTD.zip --opengfx ~/Downloads/opengfx-7.1-all.zip
python3 tests/bundle_openttd.py
```

Load the generated ZIP through the normal file picker. The script verifies pinned
SHA-256 digests, replaces all six OpenGFX GRFs plus their descriptor/readme/changelog/license,
and preserves the original NRO, music, sound, package manifest, and paths. The data
comes from the [official 7.1 release](https://cdn.openttd.org/opengfx-releases/7.1/),
including its GPL-2.0 license and source-download instructions; corresponding source
is [available here](https://cdn.openttd.org/opengfx-releases/7.1/opengfx-7.1-source.tar.xz).
No original Transport Tycoon commercial assets are downloaded or needed. This does
not modify the upstream App Store ZIP; an unchanged old ZIP still has the warning.
Use a fresh browser profile when comparing bundles, since previously imported SD
files intentionally take precedence over bundled assets.

For CPU-only Linux VM testing, a locally validated headed Chrome configuration is:

```sh
google-chrome --remote-debugging-port=9227 \
  --user-data-dir="$HOME/nxweb-chrome" \
  --enable-unsafe-webgpu \
  --enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan,WebAssemblyMemory64 \
  --use-angle=swiftshader --disable-vulkan-surface \
  --enable-dawn-features=allow_unsafe_apis
```

These flags relax browser protections: use a separate test profile for trusted
local content only. They are not needed or recommended for ordinary hardware-backed
Chrome. A WebGPU adapter alone is insufficient; successful canvas presentation must
also be checked. Connect Playwright over CDP to `http://localhost:9227` to automate
local smoke checks.

```sh
npm test                 # Node tests; runtime tests included when artifacts exist
npm run test:runtime     # requires actual built artifacts; never silently skips
ROM_PATH=/path/to/hello-world.nro node tests/keyboard_browser.mjs # Chrome CDP 9227
npm audit
```

Frontend tests cover ZIPs, saves, ROM reads/EOF/cancellation, crash watchdogs,
compatibility/diagnostic records, keyboard mappings and input dispatch, and HTTP
isolation/error paths. The artifact smoke check supports Emscripten 7's minified
exports and verifies Memory64/shared-memory flags. CI runs frontend tests on PRs.
An opt-in `workflow_dispatch` engine job caches emsdk/CPM and uploads runtime
artifacts. Node tests do **not** prove browser rendering or commercial compatibility.
The optional keyboard browser test uses an isolated context and an ephemeral server
port, and checks that Plus exits the libnx hello-world template with default,
remapped and reset bindings. Override `CDP_URL` to use a different running Chrome.

## Roadmap

1. Repeatable homebrew browser regression tests: input, graphics, audio, persistence,
   pause/resume and error UX across Chromium versions.
2. JIT/interpreter correctness comparisons, WebGPU validation and shader coverage,
   with reproducible crash/hang diagnostics.
3. Profile ROM reads, shader compilation, scheduling, memory pressure and frame
   pacing on real hardware; measure before promising speed.
4. Expand compatibility using owners' lawful dumps and reproducible reports.
   Large commercial titles such as **The Legend of Zelda: Breath of the Wild** are
   a long-term correctness/performance target, **not a supported or verified claim**.

## Legal, license and credits

**No games, cryptographic keys, firmware or user saves are included. Supply your own
lawfully obtained dumps.** Do not commit those files or distribute material you do
not have permission to share. Nintendo and game names are their owners' trademarks.

NX-Web is licensed **GPL-3.0-or-later**; see [LICENSE](LICENSE). Existing source
notices and third-party licenses remain applicable. Distributing engine artifacts
also requires satisfying their licenses and providing corresponding source, build
instructions and applicable patches; do not ship binary-only bundles.

Frontend plumbing and tests are derived from
[Shubin123/eden_web](https://github.com/Shubin123/eden_web), revision `a0162b5`,
including worker ROM reads, runtime bridge, audio, gamepads, system-file import,
saves, recovery and diagnostics. `web/app.js` and the supporting modules retain
their upstream SPDX notices. `web/shell.js` composes essential bridge elements into
the NX-Web UI; unused legacy hooks stay hidden to preserve the runtime contract.
`web/input.js` uses NX-Web's configurable keyboard bindings while preserving the
upstream gamepad and rumble paths.

Engine credit: **Shubin123** for the browser port, Wasm JIT and WebGPU work;
**Eden Emulator Project**, the **yuzu Emulator Project**, **Dynarmic / MerryMage and
contributors**, and their upstream dependencies. Homebrew/toolchain credit:
**devkitPro** and **libnx** contributors. See each upstream project for its authors
and component licenses.