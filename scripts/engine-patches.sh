#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later

reset_engine_sources() {
  git -C "$1" checkout -- .
  git -C "$1" clean -fd
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
