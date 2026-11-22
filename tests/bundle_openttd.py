# SPDX-License-Identifier: GPL-3.0-or-later
import hashlib
import importlib.util
import io
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import zipfile

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location(
    "bundle_openttd", Path(__file__).resolve().parents[1] / "scripts/bundle-openttd.py")
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)


def zip_bytes(files):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        for name, data in files.items():
            archive.writestr(name, data)
    return output.getvalue()


def graphics_bytes(names=None):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w") as archive:
        for name in bundle.GRAPHICS_FILES if names is None else names:
            member = tarfile.TarInfo("opengfx-7.1/" + name)
            data = ("new " + name).encode()
            member.size = len(data)
            archive.addfile(member, io.BytesIO(data))
    return zip_bytes({"opengfx-7.1.tar": output.getvalue()})


class BundleTests(unittest.TestCase):
    def test_replaces_only_graphics_and_preserves_manifest_and_nro(self):
        files = {bundle.PREFIX + name: b"old" for name in bundle.GRAPHICS_FILES}
        files.update({"manifest.install": b"original manifest", "info.json": b"metadata",
                      "switch/openttd/openttd.nro": b"original guest",
                      bundle.PREFIX + "openttd.grf": b"fallback graphics"})
        output = io.BytesIO()
        bundle.upgrade_bundle(zip_bytes(files), graphics_bytes(), output)
        with zipfile.ZipFile(output) as archive:
            self.assertEqual(set(archive.namelist()), set(files))
            for name, old in files.items():
                expected = ("new " + name.removeprefix(bundle.PREFIX)).encode() if (
                    name.removeprefix(bundle.PREFIX) in bundle.GRAPHICS_FILES) else old
                self.assertEqual(archive.read(name), expected)

    def test_empty_or_incomplete_graphics_rejected(self):
        for names in ([], ["opengfx.obg"]):
            with self.assertRaisesRegex(ValueError, "Incomplete"):
                bundle.graphics_files(graphics_bytes(names))

    def test_unexpected_graphics_path_rejected(self):
        with self.assertRaisesRegex(ValueError, "Unexpected"):
            bundle.graphics_files(graphics_bytes(["../../outside"]))

    def test_invalid_archive_rejected(self):
        with self.assertRaises(zipfile.BadZipFile):
            bundle.graphics_files(b"not a ZIP")

    def test_wrong_bundle_layout_rejected_before_output(self):
        output = io.BytesIO()
        with self.assertRaisesRegex(ValueError, "layout"):
            bundle.upgrade_bundle(zip_bytes({}), graphics_bytes(), output)
        self.assertEqual(output.getvalue(), b"")

    def test_cached_download_hash_checked(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "download.zip"
            path.write_bytes(b"download")
            self.assertEqual(bundle.verified_input(
                path, "unused", hashlib.sha256(b"download").hexdigest()), b"download")
            with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
                bundle.verified_input(path, "unused", "0" * 64)

    def test_download_uses_identifying_user_agent_and_checks_hash(self):
        with patch.object(bundle.urllib.request, "urlopen", return_value=io.BytesIO(b"download")) as fetch:
            self.assertEqual(bundle.verified_input(
                None, "https://example.test/release.zip",
                hashlib.sha256(b"download").hexdigest()), b"download")
            request = fetch.call_args.args[0]
            self.assertEqual(request.get_header("User-agent"), "NX-Web-OpenTTD-bundler/1.0")
            self.assertEqual(fetch.call_args.kwargs, {"timeout": 120})


if __name__ == "__main__":
    unittest.main()
