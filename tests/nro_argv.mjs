// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = mkdtempSync(path.join(os.tmpdir(), 'nro-argv-'));
try {
  const executable = path.join(directory, 'nro-argv');
  const patch = readFileSync(`${root}engine-patches/nro-homebrew-argv.patch`, 'utf8');
  const header = patch.split('+++ b/src/core/loader/nro_path.h\n')[1];
  assert.ok(header, 'NRO path helper must be included in the engine patch');
  writeFileSync(path.join(directory, 'nro_path.h'), header.split('\n').filter(line => line.startsWith('+')).map(line => line.slice(1)).join('\n'));
  const compiled = spawnSync('c++', ['-std=c++20', '-x', 'c++', '-', '-I', directory, '-o', executable], {
    encoding: 'utf8',
    input: `#include <cassert>
#include "nro_path.h"
int main() {
    using namespace Loader;
    assert(NroSdPath("/roms/OpenArenaNX.nro") == "sdmc:/switch/OpenArenaNX/OpenArenaNX.nro");
    assert(NroSdPath("/roms/switch/custom/app.nro") == "sdmc:/switch/custom/app.nro");
    assert(NroSdPath("/user/sdmc/switch/custom/app.nro") == "sdmc:/switch/custom/app.nro");
    assert(NroSdPath("sdmc:/switch/app.nro") == "sdmc:/switch/app.nro");
    assert(NroSdPath("app.NRO") == "sdmc:/switch/app/app.NRO");
    assert(NroSdPath("app") == "sdmc:/switch/app/app");
    std::string expected = "\\\"sdmc:/switch/app/app.nro\\\"";
    expected.push_back('\\0');
    assert(NroArgv("app.nro", "") == expected);
    const auto argv = NroArgv("my app.nro", "+set name \\\"player one\\\"");
    expected = "\\\"sdmc:/switch/my app/my app.nro\\\" +set name \\\"player one\\\"";
    expected.push_back('\\0');
    assert(argv == expected);
}
`,
  });
  assert.equal(compiled.status, 0, compiled.stderr);
  const result = spawnSync(executable, [], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  console.log('NRO argv: SD paths, fallback, spaces, empty and appended arguments OK');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
