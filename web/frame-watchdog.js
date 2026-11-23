// SPDX-License-Identifier: GPL-3.0-or-later

export function bootTimeoutMs(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 90_000;
}

export function createBootWatchdog({ timeoutMs, now = () => performance.now(), onStall }) {
  let file = null;
  let lastProgress = 0;
  return {
    start(selected) { file = selected; lastProgress = now(); },
    progress() { if (file) lastProgress = now(); },
    stop() { file = null; },
    tick() {
      if (!file || now() - lastProgress < timeoutMs) return;
      const selected = file;
      file = null;
      onStall(selected);
    },
  };
}

export function createFrameWatchdog({ timeoutMs, now = () => performance.now(), onFirstFrame = () => {}, onFreeze }) {
  let previousFrames = null;
  let lastFrameAt = null;
  let lastProgressAt = null;
  let previousCycles = [];
  let reported = false;
  return (state, fps, frames, guestCycles) => {
    if (state !== 2) {
      if (state === 3 && lastFrameAt !== null) lastProgressAt = now();
      return;
    }
    const time = now();
    const hasCounter = Number.isFinite(frames) && frames >= 0;
    const advanced = hasCounter ? frames > (previousFrames ?? 0) : fps > 0;
    const cpuAdvanced = Array.isArray(guestCycles) && guestCycles.some((cycles, core) =>
      Number.isFinite(cycles) && cycles >= 0 && cycles > (previousCycles[core] ?? cycles));
    if (Array.isArray(guestCycles)) {
      previousCycles = guestCycles.map(cycles => Number.isFinite(cycles) && cycles >= 0 ? cycles : undefined);
    }
    if (hasCounter) previousFrames = frames;
    if (advanced || cpuAdvanced) {
      lastProgressAt = time;
      reported = false;
    }
    if (advanced) {
      if (lastFrameAt === null) onFirstFrame();
      lastFrameAt = time;
    } else if (lastFrameAt !== null && time - lastProgressAt > timeoutMs && !reported) {
      reported = true;
      onFreeze(`no frames for ${Math.round((time - lastFrameAt) / 1000)} s`);
    }
  };
}
