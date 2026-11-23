// SPDX-License-Identifier: GPL-3.0-or-later
const G = 9.80665;
const TAU = 2 * Math.PI;
const ZERO = [0, 0, 0];
const REST = [0, 0, -1];
const FRESH_MS = 250;

const numeric = values => values.every(Number.isFinite) ? values : null;
const xyz = value => numeric([value?.x, value?.y, value?.z]);
const tuple = value => numeric([value?.[0], value?.[1], value?.[2]]);
const scaled = (vector, scale) => vector?.map(value => value * scale);
const conjugate = ([x, y, z, w]) => [-x, -y, -z, w];
function multiply([x, y, z, w], [a, b, c, d]) {
  return [w*a + x*d + y*c - z*b, w*b - x*c + y*d + z*a,
    w*c + x*b - y*a + z*d, w*d - x*a - y*b - z*c];
}
function toLocal(vector, orientation) {
  return multiply(multiply(conjugate(orientation), [...vector, 0]), orientation).slice(0, 3);
}

// DeviceOrientation applies intrinsic Z (alpha), X (beta), then Y (gamma) rotations.
function devicePose({ alpha, beta, gamma }) {
  if (!Number.isFinite(beta) || !Number.isFinite(gamma)) return null;
  const [a, b, c] = [Number.isFinite(alpha) ? alpha : 0, beta, gamma].map(value => value * TAU / 720);
  return multiply(multiply([0, 0, Math.sin(a), Math.cos(a)], [Math.sin(b), 0, 0, Math.cos(b)]),
    [0, Math.sin(c), 0, Math.cos(c)]);
}
function poseRate(previous, current, elapsed) {
  if (!previous || elapsed <= 0 || elapsed > FRESH_MS) return ZERO;
  const delta = multiply(conjugate(previous), current);
  const sinHalf = Math.hypot(...delta.slice(0, 3));
  if (sinHalf < 1e-8) return ZERO;
  // The shortest arc also handles the browser's 359° to 0° wraparound.
  const turns = Math.atan2(sinHalf, Math.abs(delta[3])) * 2 / TAU;
  return scaled(delta.slice(0, 3), Math.sign(delta[3] || 1) * turns * 1000 / (elapsed * sinHalf));
}

function gamepadSample(gamepad) {
  // GamepadPose is a legacy extension; the standard Gamepad API has no motion fields.
  const { angularVelocity, linearAcceleration, orientation } = gamepad.pose ?? {};
  const gyro = tuple(angularVelocity);
  const linear = tuple(linearAcceleration);
  const quat = numeric([orientation?.[0], orientation?.[1], orientation?.[2], orientation?.[3]]);
  const norm = quat ? Math.hypot(...quat) : 0;
  const pose = norm > 0 && Number.isFinite(norm) ? scaled(quat, 1 / norm) : null;
  if (!gyro && !linear && !pose) return null;
  const local = vector => pose ? toLocal(vector, pose) : vector;
  return {
    gyro: scaled(local(gyro ?? ZERO), 1 / TAU),
    accel: local((linear ?? ZERO).map((value, axis) => REST[axis] - value / G)),
  };
}

function keyboardSample([pitch, roll, yaw]) {
  const pose = devicePose({ alpha:0, beta:pitch * 30, gamma:roll * 30 });
  return { gyro:scaled([pitch, roll, yaw], 0.5), accel:toLocal(REST, pose) };
}

export function setupMotion({ acceptsInput, wake, connect }) {
  let keys = ZERO;
  let orientation;
  let device;
  let sentModule;
  let last = new Map();
  const hasKeys = () => keys.some(Boolean);

  window.addEventListener('deviceorientation', event => {
    if (!acceptsInput()) return;
    const pose = devicePose(event);
    if (!pose) return;
    const now = performance.now();
    const elapsed = now - (orientation?.at ?? -Infinity);
    orientation = { pose, at:now, gyro:poseRate(orientation?.pose, pose, elapsed),
      gyroUntil:now + Math.min(80, 2 * elapsed), accel:toLocal(REST, pose) };
    wake();
  });
  window.addEventListener('devicemotion', event => {
    if (!acceptsInput()) return;
    const rate = event.rotationRate;
    const gyro = scaled(numeric([rate?.beta, rate?.gamma, rate?.alpha]), 1 / 360);
    const accel = scaled(xyz(event.accelerationIncludingGravity), -1 / G);
    const linear = scaled(xyz(event.acceleration), -1 / G);
    if (!gyro && !accel && !linear) return;
    device = { at:performance.now(), gyro, accel, linear };
    wake();
  });

  function deviceSample(now) {
    const recent = device && now - device.at < FRESH_MS ? device : null;
    if (!recent && !orientation) return null;
    const gravity = orientation?.accel ?? REST;
    return {
      gyro: recent?.gyro ?? (now < orientation?.gyroUntil ? orientation.gyro : ZERO),
      accel: recent?.accel ?? gravity.map((value, axis) => value + (recent?.linear?.[axis] ?? 0)),
    };
  }

  function update(module, pads, playerForSlot, enabled) {
    if (module !== sentModule) { sentModule = module; last = new Map(); }
    if (typeof module?._eden_set_motion !== 'function') return false;
    const now = performance.now();
    const samples = new Map();
    if (enabled) {
      pads.forEach((pad, slot) => {
        const player = playerForSlot(slot);
        if (samples.has(player)) return;
        const sample = gamepadSample(pad);
        if (sample) samples.set(player, { source:pad.index, ...sample });
      });
      if (hasKeys()) samples.set(0, { source:'keyboard', ...keyboardSample(keys) });
      else if (!samples.has(0)) {
        const sample = deviceSample(now);
        if (sample) samples.set(0, { source:'device', ...sample });
      }
    } else {
      orientation = device = undefined;
    }
    const send = (player, dt, gyro, accel) => module._eden_set_motion(player, dt,
      ...[...gyro, ...accel].map(value => Math.max(-16, Math.min(16, value))));
    // Keep feeding gravity after a source goes away so Eden's orientation filter can settle.
    for (const player of last.keys()) {
      if (!samples.has(player)) samples.set(player, { source:'rest', gyro:ZERO, accel:REST });
    }
    for (const [player, { source, gyro, accel }] of samples) {
      if (player > 0 && source !== 'rest') connect(module, player);
      const previous = last.get(player);
      const elapsed = now - (previous?.at ?? now);
      if (previous?.source === source && elapsed < (source === 'rest' ? 16 : 8)) {
        samples.set(player, previous);
        continue;
      }
      const dt = previous?.source === source && elapsed <= 100 ? Math.round(elapsed * 1000) : 0;
      send(player, dt, gyro, accel);
      samples.set(player, { source, at:now });
    }
    last = samples;
    return samples.size > 0;
  }

  const permissionApis = [window.DeviceMotionEvent, window.DeviceOrientationEvent]
    .filter(api => typeof api?.requestPermission === 'function');
  return {
    update,
    setKeys(directions) {
      if (!hasKeys() && !directions.some(Boolean)) return;
      keys = directions;
      wake();
    },
    release(module) {
      keys = ZERO;
      update(module, [], () => 0, false);
    },
    needsPermission: permissionApis.length > 0,
    async requestPermission() {
      const results = await Promise.allSettled(permissionApis.map(async api => api.requestPermission()));
      return results.some(result => result.status === 'fulfilled' && result.value === 'granted');
    },
  };
}
