// SPDX-License-Identifier: GPL-3.0-or-later
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root = new URL('../', import.meta.url);
const runtime = new URL('web/runtime/', root);
const files = {};
for (const name of (await readdir(runtime)).filter(name => /^eden.*\.(js|wasm)$/.test(name)).sort()) {
  const bytes = await readFile(new URL(name, runtime));
  files[name] = { size:bytes.length, sha256:createHash('sha256').update(bytes).digest('hex') };
}
const engineRevision = execFileSync('git', ['-C', new URL('engine', root).pathname, 'rev-parse', '--short=7', 'HEAD'], {encoding:'utf8'}).trim();
await writeFile(new URL('runtime.json', runtime), `${JSON.stringify({ engineRevision, build:'release', syncedAt:new Date().toISOString(), files },null,2)}\n`);
