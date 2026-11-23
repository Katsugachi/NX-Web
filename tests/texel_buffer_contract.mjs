// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const patch = await readFile(new URL('../engine-patches/zz-webgpu-texel-buffers.patch', import.meta.url), 'utf8');
const added = patch.split('\n').filter(line => line.startsWith('+') && !line.startsWith('+++'))
  .map(line => line.slice(1)).join('\n');
const start = added.indexOf('if (!GetTexelBufferFormat(view.format))');
const end = added.indexOf('buffer_cache.BindGraphicsTextureBuffer', start);
assert.ok(start >= 0 && end > start, 'Find the per-draw texel format validation');
const rejection = added.slice(start, end);
assert.match(rejection, /return false;/, 'Reject a draw with an unsupported format');
assert.doesNotMatch(rejection, /\bvalid\s*=/,
  'A dynamic texel format must not permanently invalidate the cached shader pipeline');
console.log('WebGPU texel-buffer draw-state contract: unsupported format rejection is transient.');
