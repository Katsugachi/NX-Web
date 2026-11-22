// SPDX-License-Identifier: GPL-3.0-or-later

export function playerFps(state, fps) {
  return state === 2 ? `${(Number.isFinite(fps) ? fps : 0).toFixed(1)} FPS` : state === 3 ? 'Paused' : '--';
}

export async function rebootGame(file, { stash, mark, shutdown, reload }) {
  if (!file) throw new Error('No game is loaded.');
  await stash(file);
  mark(file);
  shutdown();
  reload();
}

export function createPipCapture(canvas, video, timeoutMs = 3000) {
  let cancel;
  function stop() {
    cancel?.(new Error('Picture-in-picture was cancelled.'));
    video.srcObject?.getTracks().forEach(track => track.stop());
    video.srcObject = null;
  }
  async function start() {
    let timer;
    try {
      video.srcObject = canvas.captureStream(60);
      await Promise.race([
        video.play(),
        new Promise((_, reject) => {
          cancel = reject;
          timer = setTimeout(() => reject(new Error('No video frame is available yet.')), timeoutMs);
        }),
      ]);
    } catch (err) {
      stop();
      throw err;
    } finally {
      clearTimeout(timer);
      cancel = null;
    }
  }
  return { start, stop };
}
