# AudioRenderer buffer-progress probe

Self-written libnx homebrew; no game assets, firmware, or keys are required.
It emits a stereo square wave through AudioRenderer using two 1024-frame,
44.1 kHz buffers, like older SDL2 Switch audio backends. It runs for 30 seconds,
then leaves its result in the emulator log. Every 32 submissions it suspends
the client for 80 ms, longer than both queued buffers, while the renderer
continues running. The browser compatibility mitigation must preserve the
intermediate Playing observation across that scheduling gap.

Build with devkitA64 and libnx:

```sh
make
# Or, from this directory:
docker run --rm -v "$PWD:/work" -w /work devkitpro/devkita64:latest make
```

From the NX-Web root, with a headed WebGPU browser listening on CDP port 9227:

```sh
source ~/.nvm/nvm.sh && nvm use 24
ROM_PATH="$PWD/tests/fixtures/audio-renderer/audio-renderer.nro" \
  AUDIO_SECONDS=40 AUDIO_KEY='' AUDIO_REPORT="$HOME/audio-renderer-report.json" \
  node tests/audio_renderer_browser.mjs
```

The browser probe asserts that output PCM is nonzero and that its report has
both `AUDIO_RENDERER empty failures=0` and
`AUDIO_RENDERER result failures=0`. API/initialization errors have separate
`*_ERROR` markers. The final counter also requires at least 20 seconds of
sample progress during the 30-second run.

The diagnostic counts a failure if a queued buffer becomes Done without the
client ever observing Playing. Unlike older SDL2 backends, it requeues that
buffer rather than waiting forever. This detects a condition that can strand
those clients. This is a regression test for NX-Web's browser compatibility
policy, **not** a hardware-conformance test: a sufficiently long client
scheduling pause can legitimately miss the intermediate state without that
policy. A PCM pass alone does not prove that this condition is absent or that
Quakespasm is fixed, so the wrapper also asserts the guest's failure counters.
