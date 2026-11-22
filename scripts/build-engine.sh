#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
export PATH="$HOME/.local/bin:$PATH"
for tool in git python3 curl patch ninja glslangValidator make perl pkg-config c++; do
  if ! command -v "$tool" >/dev/null; then
    echo "Missing $tool. On Ubuntu: sudo apt install build-essential ninja-build glslang-tools python3-pip curl patch perl pkg-config" >&2
    exit 1
  fi
done
if ! python3 -c 'import shutil, subprocess, re; p=shutil.which("cmake"); assert p; v=subprocess.check_output([p,"--version"],text=True); assert tuple(map(int,re.search(r"(\d+)\.(\d+)",v).groups())) >= (3,31)' 2>/dev/null; then
  python3 -m pip install --user 'cmake==4.4.5'
fi
sdk=${EMSDK:-$HOME/emsdk}
version=${EMSDK_VERSION:-7.0.1}
if [ ! -f "$sdk/emsdk_env.sh" ]; then
  git clone --depth 1 https://github.com/emscripten-core/emsdk.git "$sdk"
fi
"$sdk/emsdk" install "$version"
"$sdk/emsdk" activate "$version"
source "$sdk/emsdk_env.sh"
cmake --version
emcc --version
git -C "$root" submodule update --init engine
export EDEN_BUILD_JOBS=${EDEN_BUILD_JOBS:-4}
export EDEN_DEV=0 EDEN_CONFIGURE_ONLY=0
EDEN_CONFIGURE_ONLY=1 bash "$root/engine/tools/web/build.sh"
for fix in "$root"/engine-patches/*.patch; do
  if patch --dry-run --batch --forward --fuzz=0 --silent -d "$root/engine" -p1 < "$fix"; then
    patch --batch --forward --fuzz=0 -d "$root/engine" -p1 < "$fix"
  elif patch --dry-run --batch --fuzz=0 --silent --reverse -d "$root/engine" -p1 < "$fix"; then
    echo "Already applied: $(basename "$fix")"
  else
    echo "Patch no longer applies: $fix" >&2
    exit 1
  fi
done
bash "$root/engine/tools/web/build.sh"
bash "$root/engine/tools/web/build-archive.sh"
mkdir -p "$root/web/runtime"
cp "$root"/engine/build-web/bin/eden*.js "$root"/engine/build-web/bin/eden*.wasm "$root/web/runtime/"
node "$root/scripts/runtime-manifest.mjs"
echo "NX-Web runtime installed in $root/web/runtime"
