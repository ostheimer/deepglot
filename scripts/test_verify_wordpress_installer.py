import hashlib
import importlib.util
import io
import json
from pathlib import Path
import unittest
from urllib.parse import urlencode
import zipfile


SCRIPT = Path(__file__).with_name("verify-wordpress-installer.py")
SPEC = importlib.util.spec_from_file_location("verify_wordpress_installer", SCRIPT)
assert SPEC and SPEC.loader
verifier = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(verifier)


def archive(version: str, body: str = "runtime") -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as zip_file:
        zip_file.writestr("deepglot/deepglot.php", f"<?php\n * Version: {version}\n")
        zip_file.writestr("deepglot/readme.txt", f"Stable tag: {version}\n")
        zip_file.writestr("deepglot/includes/runtime.php", body)
    return output.getvalue()


class InstallerAcceptanceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.version = "1.2.3"
        self.manifest = {
            "version": self.version,
            "directoryUrl": "https://wordpress.org/plugins/deepglot/",
            "downloadUrl": "https://downloads.wordpress.org/plugin/deepglot.1.2.3.zip",
            "releaseZipUrl": "https://github.com/ostheimer/deepglot/releases/download/wp-plugin-v1.2.3/deepglot-1.2.3.zip",
            "releaseChecksumUrl": "https://github.com/ostheimer/deepglot/releases/download/wp-plugin-v1.2.3/deepglot-1.2.3.zip.sha256",
        }
        self.release = archive(self.version)
        query = urlencode({"action": "plugin_information", "request[slug]": "deepglot", "request[fields][sections]": "0"})
        self.responses = {
            self.manifest["directoryUrl"]: b"<h1>Deepglot</h1>",
            verifier.API + "?" + query: json.dumps({"slug": "deepglot", "version": self.version, "download_link": self.manifest["downloadUrl"]}).encode(),
            self.manifest["downloadUrl"]: self.release,
            self.manifest["releaseZipUrl"]: self.release,
            self.manifest["releaseChecksumUrl"]: f"{hashlib.sha256(self.release).hexdigest()}  deepglot-{self.version}.zip\n".encode(),
        }

    def download(self, url: str, limit: int = 10_000_000) -> bytes:
        if url not in self.responses:
            raise RuntimeError(f"Missing artifact: {url}")
        return self.responses[url]

    def test_accepts_matching_directory_and_release(self) -> None:
        _, _, count = verifier.verify(self.manifest, self.download)
        self.assertEqual(count, 3)

    def test_fails_when_advertised_zip_is_missing(self) -> None:
        del self.responses[self.manifest["downloadUrl"]]
        with self.assertRaisesRegex(RuntimeError, "Missing artifact"):
            verifier.verify(self.manifest, self.download)

    def test_fails_when_public_version_differs(self) -> None:
        self.responses[self.manifest["downloadUrl"]] = archive("1.2.2")
        with self.assertRaisesRegex(ValueError, "plugin header differs"):
            verifier.verify(self.manifest, self.download)

    def test_fails_when_release_checksum_differs(self) -> None:
        self.responses[self.manifest["releaseChecksumUrl"]] = b"0" * 64 + b"  deepglot-1.2.3.zip\n"
        with self.assertRaisesRegex(ValueError, "SHA-256 sidecar"):
            verifier.verify(self.manifest, self.download)

    def test_fails_when_archive_contents_differ(self) -> None:
        self.responses[self.manifest["downloadUrl"]] = archive(self.version, "different runtime")
        with self.assertRaisesRegex(ValueError, "runtime files differ"):
            verifier.verify(self.manifest, self.download)


if __name__ == "__main__":
    unittest.main()
