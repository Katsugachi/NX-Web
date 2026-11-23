# Raw instance command ordering in the browser renderer

Taisei 1.4.6's intro rendered the em dash but omitted the rest of its caption.
The text atlas was a valid 2048x2048 `rgba8unorm` texture, with distinct glyph
rectangles and transforms in a 184-byte instance stream. R8 mapping, narrow
upload pitch, atlas contents and WebGPU's `instance_index` were not the fault.

`DrawManager::DrawEnd` submitted the first raw Maxwell instance immediately but
held subsequent BEGIN/END instances for `DrawDeferred`. That is flushed at the
next first-instance BEGIN or a macro boundary, not before arbitrary intervening
register writes. Mesa's raw stream switched framebuffer/viewport before the
flush. Captures showed the remaining 17-instance caption draw on a 200x150 blur
target instead of the foreground target; the following fullscreen blur draw
overwrote it in the same render pass. Replaying the same WebGPU pipeline and
bindings separately rendered all 17 instances. Suppressing the following draw
also preserved all 17, disproving a native instancing failure.

The Wasm path now executes raw instance commands at END, with their current
register state. An `InstanceSingle` draw mode distinguishes the native fetch
offset (guest base plus logical instance cursor) from the guest BaseInstance
shader value. WebGPU preserves the latter in DrawInfo, and WGSL computes guest
InstanceId as `instance_index - base_instance`, matching the SPIR-V backend.
InstanceId-only shaders also require per-command base-instance copies for
indirect and multidraw submissions; `ReadsDrawParameters` includes that input.
For tessellation, DrawInfo's otherwise unused `padding` holds the native fetch
base, including the raw instance cursor. Compute vertex fetches use that base;
control and evaluation InstanceId values subtract the guest base, as the vertex
stage does. Each single-instance dispatch therefore retains the correct fetch
offset and logical ID without changing the shared uniform layout.
Immediate array-instance commands likewise no longer leave a deferred batch
behind. Native backend batching is unchanged. HLE macro draws that explicitly
provide an instance count still use native instanced draws; raw/LLE instance
streams issue one host draw per instance, trading that optimization for correct
ordering without title-specific conditions.

The self-written `tests/fixtures/gl-instancing` homebrew and
`tests/gl_instancing_browser.mjs` check array/indexed instancing across FBO
switches, zero-instance draws, and nonzero base-instance fetch/InstanceId
semantics using actual screenshot pixels. Build/run instructions are in the
fixture README. No game data or generated runtime/fixture binaries belong in
git.
