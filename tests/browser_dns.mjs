// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const patch = readFileSync(new URL('../engine-patches/network-browser-no-dns.patch', import.meta.url), 'utf8');
const browser = patch.match(/\+#ifdef __EMSCRIPTEN__\n([\s\S]*?)\+#else/);
assert.ok(browser, 'Browser resolver must bypass the native addrinfo path');
const body = browser[1].split('\n').filter(line => line.startsWith('+')).map(line => line.slice(1)).join('\n');
const directory = mkdtempSync(path.join(os.tmpdir(), 'browser-dns-'));
try {
  const executable = path.join(directory, 'browser-dns');
  const compiled = spawnSync('c++', ['-std=c++20', '-x', 'c++', '-', '-o', executable], {
    encoding: 'utf8',
    input: `#include <cassert>
#include <optional>
#include <string>
#include <variant>
#include <vector>
enum class GetAddrInfoError { NONAME };
struct AddrInfo {};
std::variant<std::vector<AddrInfo>, GetAddrInfoError> GetAddressInfo(
    const std::string& host, const std::optional<std::string>& service) {
${body}
}
int main() {
    for (const auto& host : {"localhost", "127.0.0.1", "", "not-a-real-host.invalid"}) {
        for (const auto& service : {std::optional<std::string>{},
                                    std::optional<std::string>{""},
                                    std::optional<std::string>{"27960"},
                                    std::optional<std::string>{"invalid-service"}}) {
            const auto result = GetAddressInfo(host, service);
            assert(std::get<GetAddrInfoError>(result) == GetAddrInfoError::NONAME);
        }
    }
}
`,
  });
  assert.equal(compiled.status, 0, compiled.stderr);
  const result = spawnSync(executable, [], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  console.log('Browser DNS: normal, empty and invalid hosts/services return NONAME without libc resolution');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
