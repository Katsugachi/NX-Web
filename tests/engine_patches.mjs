// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const helper = fileURLToPath(new URL('../scripts/engine-patches.sh', import.meta.url));
const directory = mkdtempSync(path.join(os.tmpdir(), 'engine-patches-'));
const engine = path.join(directory, 'engine');
const patches = path.join(directory, 'engine-patches');
const run = (command, args, cwd = directory) => {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
};
const apply = (reset = false) => spawnSync('bash', ['-euc',
  'source "$1"; if [ "$3" = true ]; then reset_engine_sources "$2/engine"; fi; apply_engine_patches "$2"',
  'patch-test', helper, directory, String(reset)], { encoding: 'utf8' });
const check = result => {
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(readFileSync(path.join(engine, 'source.txt'), 'utf8'), 'after\n');
  assert.equal(readFileSync(path.join(engine, 'new.h'), 'utf8'), 'header\n');
};
try {
  mkdirSync(engine);
  mkdirSync(patches);
  run('git', ['init', '-q'], engine);
  writeFileSync(path.join(engine, '.gitignore'), 'build-web/\n.cache/\n');
  writeFileSync(path.join(engine, 'source.txt'), 'before\n');
  run('git', ['add', '.gitignore', 'source.txt'], engine);
  run('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'fixture'], engine);
  assert.equal(apply().status, 0, 'empty patch directory');
  writeFileSync(path.join(patches, 'feature.patch'), `--- a/source.txt
+++ b/source.txt
@@ -1 +1 @@
-before
+after
--- /dev/null
+++ b/new.h
@@ -0,0 +1 @@
+header
`);
  check(apply());
  const already = apply();
  check(already);
  assert.match(already.stdout, /^Already applied: feature.patch$/m);

  run('git', ['checkout', '--', '.'], engine);
  const partial = apply();
  assert.notEqual(partial.status, 0, 'mixed forward/reverse patch must fail');
  assert.doesNotMatch(partial.stdout, /Already applied:/);
  assert.match(partial.stderr, /Patch no longer applies:/);
  assert.equal(readFileSync(path.join(engine, 'source.txt'), 'utf8'), 'before\n');

  mkdirSync(path.join(engine, 'build-web'));
  mkdirSync(path.join(engine, '.cache'));
  writeFileSync(path.join(engine, 'build-web', 'keep'), 'build');
  writeFileSync(path.join(engine, '.cache', 'keep'), 'cache');
  writeFileSync(path.join(engine, 'source.txt.orig'), 'backup');
  writeFileSync(path.join(engine, 'source.txt.rej'), 'reject');
  writeFileSync(path.join(engine, 'local-notes.txt'), 'keep my notes');
  writeFileSync(path.join(engine, 'unrelated.orig'), 'keep unrelated backup');
  for (let iteration = 0; iteration < 2; iteration++) {
    const rebuilt = apply(true);
    check(rebuilt);
    assert.doesNotMatch(rebuilt.stdout, /Already applied:/);
    assert.equal(readFileSync(path.join(engine, 'build-web', 'keep'), 'utf8'), 'build');
    assert.equal(readFileSync(path.join(engine, '.cache', 'keep'), 'utf8'), 'cache');
    assert.equal(readFileSync(path.join(engine, 'local-notes.txt'), 'utf8'), 'keep my notes');
    assert.equal(readFileSync(path.join(engine, 'unrelated.orig'), 'utf8'), 'keep unrelated backup');
    assert.equal(existsSync(path.join(engine, 'source.txt.orig')), false);
    assert.equal(existsSync(path.join(engine, 'source.txt.rej')), false);
  }
  writeFileSync(path.join(engine, 'source.txt'), 'incompatible\n');
  const incompatible = apply();
  assert.notEqual(incompatible.status, 0);
  assert.doesNotMatch(incompatible.stdout, /Already applied:/);
  console.log('Engine patches: pristine, already applied, partial/untracked, repeated reset, preserved local files, ignored outputs and conflicts OK');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
