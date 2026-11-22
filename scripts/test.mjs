// SPDX-License-Identifier: GPL-3.0-or-later
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const tests = ['zip_reader.mjs', 'homebrew_bundle.mjs', 'nro_argv.mjs', 'browser_dns.mjs', 'saves.mjs', 'session_lock.mjs', 'time_limit.mjs', 'rom_file.mjs',
  'frame_watchdog.mjs', 'results.mjs', 'compat.mjs', 'compare_results.mjs',
  'diagnostics.mjs', 'agent_protocol.mjs', 'shell.mjs', 'input.mjs', 'server.mjs', 'player_session.mjs'];
for (const test of ['web_artifact_smoke.cjs', 'archive_reader.mjs']) {
  const artifact = test.endsWith('.cjs') ? 'eden.wasm' : 'eden_archive.js';
  if (existsSync(new URL(`../web/runtime/${artifact}`, import.meta.url))) tests.push(test);
  else console.log(`SKIP ${test}: build the engine to enable artifact checks (npm run build:engine).`);
}
for (const test of tests) {
  const result = spawnSync(process.execPath, [new URL(`../tests/${test}`, import.meta.url).pathname], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`NX-Web: ${tests.length} test files passed.`);
