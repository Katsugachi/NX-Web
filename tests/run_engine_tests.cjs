// SPDX-License-Identifier: GPL-3.0-or-later
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

if (!process.argv[2]) throw new Error('Pass a generated Emscripten test executable (.js)');
const sourcePath = path.resolve(process.argv[2]);
const filename = sourcePath.replace(/\.js$/, '.cjs');
const compiled = new Module(filename, module);
compiled.filename = filename;
compiled.paths = Module._nodeModulePaths(path.dirname(filename));
process.argv.splice(1, 1);
compiled._compile(fs.readFileSync(sourcePath, 'utf8'), filename);
