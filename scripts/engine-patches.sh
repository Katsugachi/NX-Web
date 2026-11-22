#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later

reset_engine_sources() {
  git -C "$1" checkout -- . || return 1
  python3 - "$1" <<'PY'
from pathlib import Path
import subprocess
import sys

engine = Path(sys.argv[1]).resolve()
tracked = set(subprocess.check_output(
    ['git', '-C', str(engine), 'ls-files', '-z']).decode().split('\0'))
remove = set()
for patch in sorted((engine.parent / 'engine-patches').glob('*.patch')):
    lines = patch.read_text().splitlines()
    for old, new in zip(lines, lines[1:]):
        if not old.startswith('--- ') or not new.startswith('+++ b/'):
            continue
        name = new[6:].split('\t', 1)[0]
        if old == '--- /dev/null':
            remove.add(name)
        remove.update((name + '.orig', name + '.rej'))
for name in sorted(remove):
    file = engine / name
    if name not in tracked and file.parent.resolve().is_relative_to(engine):
        file.unlink(missing_ok=True)
PY
}

apply_engine_patches() {
  local root=$1 fix
  for fix in "$root"/engine-patches/*.patch; do
    [ -e "$fix" ] || continue
    if patch --dry-run --batch --forward --fuzz=0 --silent -d "$root/engine" -p1 < "$fix"; then
      patch --batch --forward --fuzz=0 -d "$root/engine" -p1 < "$fix" || return 1
      if [ "$(basename "$fix")" = web-player-one.patch ]; then source_patched=true; fi
    elif patch --dry-run --force --reverse --fuzz=0 --silent -d "$root/engine" -p1 < "$fix"; then
      echo "Already applied: $(basename "$fix")"
    else
      echo "Patch no longer applies: $fix" >&2
      return 1
    fi
  done
}
