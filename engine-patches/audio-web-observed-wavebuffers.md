# Browser AudioRenderer completion observation

`audio-web-observed-wavebuffers.patch` is a browser-only compatibility policy,
not a change to native scheduling or a game-specific workaround.

## Failure and bounded investigation

QuakespasmNX 0.4.0's bundled SDL2 Switch backend waits for a newly queued buffer
to become Playing, but never accepts Done. Its audio thread can therefore stay
in PlayDevice forever if both queued buffers finish between RequestUpdate
observations. Once stranded, Quake's DMA sample position stops advancing and
subsequent firing remains silent even though browser audio callbacks continue.

A host-side capture of a failing stock-ROM run recorded the actual kernel
state changes, context switches, renderer event signals/clears and outgoing
voice counters. The audio thread ran on core 1 at priority 59; the game thread
ran on core 0 at priority 44 (lower numbers are higher priority). In the final
14.375 ms update gap, the audio thread's ready-to-switch delays were 1.776 ms
and 0.621 ms. Five renderer event signals arrived within 0.410 ms, and the
consumed count jumped from 47 to 49. The corresponding decoded-sample jump
was 1043 samples at 44100 Hz, or about 23.65 ms of source audio.

That capture does not establish a missing kernel preemption/wakeup defect or
a high-priority thread starved by the game. Browser callback-driven renderer
catch-up can itself skip the intermediate state. Earlier longer scheduling
gaps can trigger the same failure. The mitigation consequently avoids a
scheduler rewrite and does not assume a maximum host scheduling delay.

## Policy

Each voice remembers the completion count returned by RequestUpdate. Command
generation copies that watermark to every channel's DSP state, using the
existing renderer command handoff rather than a concurrently written field.

The decoder can retire one buffer beyond the observed count, but cannot retire
its successor until the client has observed that completion. It still decodes
the successor's PCM normally; if it reaches its end first, it retains the
buffer's valid flag and end offset and uses the existing starved/zero-input
path for subsequent output. An update reporting the predecessor's completion
lets libnx mark the successor Playing. Rendering can then retire it without
decoding or counting its samples twice.

This applies per voice/channel to finite PCM/ADPCM wave buffers. Infinite loops
do not retire buffers and are not throttled. Existing stop/flush behavior is
unchanged, and new voices reset the watermark. Native builds and AudioOut are
unchanged. There are no wall-clock sleeps, guest-memory scans, debug exports,
or title identifiers in the patch.

The deliberate trade-off is that delayed clients, including clients queuing
very short buffers, can get silence instead of several unobserved completions.
This is an observability/compatibility bound, not hardware-accurate completion
timing and not a guarantee of uninterrupted audio on an overloaded browser.

## Regression coverage

Build `tests/fixtures/audio-renderer/` with devkitA64 and run
`node tests/audio_renderer_browser.mjs` with a headed WebGPU browser on CDP
9227. The fixture deliberately delays client updates for 80 ms every 32
submissions, checks that every queued buffer is observed Playing before Done,
and checks empty-queue behavior and sustained sample progress. The wrapper
asserts the guest counters as well as nonzero browser PCM. See its README for
the full command and artifact paths.

Before this policy, that delayed-client test reported 28 missed observations
despite nonzero PCM. With the policy it reported zero. Stock Quakespasm is
tested separately with real menu navigation and sustained firing; passing the
synthetic PCM test alone is not evidence that gameplay is fixed.
