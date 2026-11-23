# GL instancing / framebuffer ordering fixture

Self-written libnx + Mesa/EGL homebrew. It renders three RGB rows into an FBO:
array instancing, array instancing with base instance 1, and indexed instancing.
The vertex shader colors by `gl_InstanceID`; divisor-1 attributes position the
quads. A zero-instance draw must add nothing. It switches to a smaller FBO and
copies the result before presenting, exercising state changes after instancing.
Shader compilation/linking, EGL setup, framebuffer completeness, and GL errors
are checked and reported through `svcOutputDebugString`.

Build with devkitPro and the Switch Mesa portlibs (no game assets):

```sh
docker run --rm -v "$PWD/tests/fixtures/gl-instancing:/work" -w /work \
  mirror.gcr.io/devkitpro/devkita64 make
```

Run with the normal headed WebGPU Chrome on CDP port 9227 and a built runtime:

```sh
ROM_PATH="$PWD/tests/fixtures/gl-instancing/gl-instancing.nro" \
  GL_SCREENSHOT="$HOME/gl-instancing.png" node tests/gl_instancing_browser.mjs
```

The browser test checks screenshot pixels, not just shader creation or app boot.
It expects exactly nine colored components, RGB order on each row, and a
one-element position shift (but no `gl_InstanceID` color shift) for base instance
1. `GL_LOG` saves guest/browser logs; `GL_SECONDS` controls warmup (default 25).
For local before/after comparisons, `GL_RUNTIME_DIR` overrides the `eden.js` and
`eden.wasm` responses with files in that directory. Generated NRO/ELF files stay
ignored. This opt-in browser test is not part of `npm test`.
