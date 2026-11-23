# SuperTuxKart: PRET and skinned geometry

These are two independent renderer issues. `zz-maxwell-pret.patch` fixes Maxwell
control flow shared by all backends. `zz-webgpu-texel-buffers.patch` fixes graphics
texture-buffer reads in WebGPU, which SuperTuxKart uses for its skinning matrices.

## PRET

The [upstream Eden control-flow analyzer](https://git.eden-emu.dev/eden-emu/eden/src/branch/master/src/shader_recompiler/frontend/maxwell/control_flow.cpp)
still threw `PRET flow analysis is not implemented` when investigated. Rather than
introducing a backend-specific return stack, the patch reuses its CAL/RET function
inliner: PRET calls the fallthrough instruction, with the explicit relative target
as its continuation. Nested calls, shared subroutines, conditional returns and
shader exits use the existing structured-control-flow machinery. Constant-buffer
PRET targets remain explicitly unsupported.

In STK, vertex-B shader `571df77fcdf3bfce` failed translation in pipelines
`5a82c7bcad3e4a88`, `5e91bfcbe8b172b8`, `afaee56a68c09634` and `60c2a60dfab47dfc`.
Removing those failures alone did **not** restore the kart bodies.

## Skinning

The old WGSL `EmitImageFetch` returned zero for buffer textures. STK's
`sp_skinning.vert` fetches its joint matrices through `samplerBuffer`; zero matrices
collapse the entire skinned mesh. The kart-selection pipeline was
`bff6e8a8acfc7bf5`, vertex-B shader `c4175d88b0f7fc32` (one texture-buffer
descriptor). A diagnostic substitution of
identity skinning, without changing the baseline engine, restored Tux and the kart
body. That substitution is not part of either patch and is not needed by the fix.

Graphics texel buffers now go through the existing coherent buffer cache and are
bound as read-only storage with per-draw byte offset, texel count and format
metadata. WGSL decodes scalar/vector 8/16/32-bit float, integer and normalized
formats, preserves integer bit patterns and missing-channel defaults, and bounds
checks fetches. Unsupported packed/compressed formats fail the pipeline explicitly
instead of silently returning zero. Read buffers participate in existing
read/write alias handling. Compute texel-buffer and image-buffer support is
unchanged; these patches do not implement those stubs.

## Checks

Build the runtime with the normal patch workflow (alphabetical, `--fuzz=0`):

```sh
EDEN_BUILD_JOBS=8 bash scripts/build-engine.sh
```

With the repository's Emscripten environment and Node 24 loaded, enable and build
the focused C++ tests in the existing build directory:

```sh
cmake -S engine -B engine/build-web -DYUZU_TESTS=ON
cmake --build engine/build-web --target shader_control_flow_tests -j8
node tests/run_engine_tests.cjs engine/build-web/bin/shader_control_flow_tests.js > "$HOME/shader-tests.log"
```

The CommonJS wrapper is needed because generated Emscripten test runners are
CommonJS while the parent repository uses ES modules. Native builds can run the
test executable directly instead.

The following optional GPU test compiles the **generated** WGSL helper and checks
numeric fetch results, default channels, offsets, out-of-range and empty reads,
and updated backing data on SwiftShader. It needs Chrome and a display (or Xvfb);
`HEADLESS=1` selects headless Chrome.

```sh
CHROME_PATH=/path/to/google-chrome node tests/texel_buffer_gpu.mjs "$HOME/shader-tests.log"
npm ci && npm test
```

The frontend suite does not run the optional engine/GPU tests. GL/Vulkan share
the PRET analyzer and inliner; the texel-buffer patch is WGSL/WebGPU-specific.
