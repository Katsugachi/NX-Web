#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Refresh the Homebrew App Store OpenTTD ZIP with official GPL-2.0 OpenGFX."""

import argparse
import hashlib
import io
from pathlib import Path
import tarfile
import urllib.request
import zipfile


BUNDLE_URL = "https://switch.cdn.fortheusers.org/zips/OpenTTD.zip"
BUNDLE_SHA256 = "f6f0b07d2e7fb0061fb6e99bcecf73652847d882d923dd88519b982767d49039"
GRAPHICS_URL = "https://cdn.openttd.org/opengfx-releases/7.1/opengfx-7.1-all.zip"
GRAPHICS_SHA256 = "928fcf34efd0719a3560cbab6821d71ce686b6315e8825360fba87a7a94d7846"
GRAPHICS_FILES = {
    "ogfx1_base.grf", "ogfxc_arctic.grf", "ogfxe_extra.grf",
    "ogfxh_tropical.grf", "ogfxi_logos.grf", "ogfxt_toyland.grf",
    "opengfx.obg", "readme.txt", "changelog.txt", "license.txt",
}
PREFIX = "switch/openttd/baseset/"


def verified_input(path, url, digest):
    if path:
        data = Path(path).read_bytes()
    else:
        request = urllib.request.Request(url, headers={"User-Agent": "NX-Web-OpenTTD-bundler/1.0"})
        with urllib.request.urlopen(request, timeout=120) as response:
            data = response.read()
    if hashlib.sha256(data).hexdigest() != digest:
        raise ValueError(f"SHA-256 mismatch: {path or url}")
    return data


def graphics_files(data):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        tar_data = archive.read("opengfx-7.1.tar")
    files = {}
    with tarfile.open(fileobj=io.BytesIO(tar_data)) as archive:
        for member in archive.getmembers():
            if member.isdir() and member.name == "opengfx-7.1":
                continue
            name = member.name.removeprefix("opengfx-7.1/")
            if not member.isfile() or name not in GRAPHICS_FILES or name in files:
                raise ValueError(f"Unexpected OpenGFX member: {member.name}")
            files[name] = archive.extractfile(member).read()
    if set(files) != GRAPHICS_FILES:
        raise ValueError("Incomplete OpenGFX release")
    return files


def upgrade_bundle(bundle, graphics, output):
    replacements = {PREFIX + name: data for name, data in graphics_files(graphics).items()}
    with zipfile.ZipFile(io.BytesIO(bundle)) as source:
        names = source.namelist()
        if len(names) != len(set(names)) or not replacements.keys() <= set(names):
            raise ValueError("Expected the flat OpenTTD Homebrew App Store baseset layout")
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as target:
            for entry in source.infolist():
                data = replacements.get(entry.filename)
                target.writestr(entry, source.read(entry) if data is None else data)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, help="output ZIP (keep outside the repository)")
    parser.add_argument("--bundle", type=Path, help="cached original Homebrew App Store ZIP")
    parser.add_argument("--opengfx", type=Path, help="cached official OpenGFX 7.1 all ZIP")
    args = parser.parse_args()
    if args.output.exists():
        parser.error("output already exists")
    bundle = verified_input(args.bundle, BUNDLE_URL, BUNDLE_SHA256)
    graphics = verified_input(args.opengfx, GRAPHICS_URL, GRAPHICS_SHA256)
    upgrade_bundle(bundle, graphics, args.output)
    print(f"OpenTTD ZIP refreshed with OpenGFX 7.1 (GPL-2.0): {args.output}")


if __name__ == "__main__":
    main()
