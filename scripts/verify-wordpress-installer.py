#!/usr/bin/env python3
"""Fail CI if the installer advertised in the dashboard is absent or stale."""

import hashlib
import io
import json
from pathlib import Path
import re
import sys
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen
import zipfile


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "src/lib/wordpress-installer.json"
API = "https://api.wordpress.org/plugins/info/1.2/"


def fetch(url: str, limit: int = 10_000_000) -> bytes:
    last_error = None
    for attempt in range(3):
        try:
            with urlopen(Request(url, headers={"User-Agent": "Deepglot-installer-acceptance/1.0"}), timeout=30) as response:
                data = response.read(limit + 1)
                if len(data) > limit:
                    raise ValueError(f"Response exceeds {limit} bytes: {url}")
                return data
        except (OSError, TimeoutError) as error:
            last_error = error
            if attempt < 2:
                time.sleep(attempt + 1)
    raise RuntimeError(f"Could not read {url}: {last_error}")


def contents(blob: bytes, label: str) -> dict[str, str]:
    with zipfile.ZipFile(io.BytesIO(blob)) as archive:
        bad_file = archive.testzip()
        if bad_file:
            raise ValueError(f"{label} has a corrupt member: {bad_file}")
        names = [name for name in archive.namelist() if not name.endswith("/")]
        if len(names) != len(set(names)) or not names:
            raise ValueError(f"{label} has duplicate or no runtime files")
        if any(not name.startswith("deepglot/") or ".." in Path(name).parts for name in names):
            raise ValueError(f"{label} has a member outside deepglot/")
        return {name: hashlib.sha256(archive.read(name)).hexdigest() for name in names}


def member(blob: bytes, name: str) -> str:
    with zipfile.ZipFile(io.BytesIO(blob)) as archive:
        return archive.read(name).decode("utf-8")


def require_version(blob: bytes, version: str, label: str) -> None:
    plugin = member(blob, "deepglot/deepglot.php")
    readme = member(blob, "deepglot/readme.txt")
    if not re.search(r"^ \* Version: " + re.escape(version) + r"$", plugin, re.MULTILINE):
        raise ValueError(f"{label} plugin header differs from {version}")
    if not re.search(r"^Stable tag: " + re.escape(version) + r"$", readme, re.MULTILINE):
        raise ValueError(f"{label} stable tag differs from {version}")


def verify(manifest: dict, download=fetch) -> tuple[str, str, int]:
    version = manifest["version"]
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise ValueError("Installer manifest has an invalid version")
    if manifest["directoryUrl"] != "https://wordpress.org/plugins/deepglot/":
        raise ValueError("Installer directory link is not the public Deepglot entry")
    expected_download = f"https://downloads.wordpress.org/plugin/deepglot.{version}.zip"
    expected_release = f"https://github.com/ostheimer/deepglot/releases/download/wp-plugin-v{version}/deepglot-{version}.zip"
    if manifest["downloadUrl"] != expected_download or manifest["releaseZipUrl"] != expected_release:
        raise ValueError("Installer URLs do not match the advertised version")
    if manifest["releaseChecksumUrl"] != expected_release + ".sha256":
        raise ValueError("Release checksum URL does not match its ZIP")

    directory = download(manifest["directoryUrl"], 2_000_000).decode("utf-8")
    if not re.search(r"<h1[^>]*>\s*Deepglot\s*</h1>", directory, re.IGNORECASE):
        raise ValueError("WordPress.org directory page does not identify Deepglot")

    query = urlencode({"action": "plugin_information", "request[slug]": "deepglot", "request[fields][sections]": "0"})
    info = json.loads(download(API + "?" + query))
    if info.get("slug") != "deepglot" or info.get("version") != version:
        raise ValueError(f"WordPress.org API version differs from {version}: {info.get('version')}")
    if info.get("download_link") != manifest["downloadUrl"]:
        raise ValueError("WordPress.org API download URL differs from the advertised ZIP")

    public_zip = download(manifest["downloadUrl"])
    release_zip = download(manifest["releaseZipUrl"])
    checksum = download(manifest["releaseChecksumUrl"], 1024).decode("ascii").strip()
    release_hash = hashlib.sha256(release_zip).hexdigest()
    if checksum != f"{release_hash}  deepglot-{version}.zip":
        raise ValueError("GitHub release ZIP does not match its SHA-256 sidecar")
    require_version(public_zip, version, "WordPress.org ZIP")
    require_version(release_zip, version, "GitHub release ZIP")
    public_contents = contents(public_zip, "WordPress.org ZIP")
    if public_contents != contents(release_zip, "GitHub release ZIP"):
        raise ValueError("WordPress.org ZIP runtime files differ from the GitHub release")

    return hashlib.sha256(public_zip).hexdigest(), release_hash, len(public_contents)


def main() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    public_hash, release_hash, file_count = verify(manifest)
    print(f"Deepglot {manifest['version']}: directory, API, ZIP headers, SHA-256 sidecar and {file_count} runtime files verified")
    print(f"WordPress.org ZIP SHA-256: {public_hash}")
    print(f"GitHub release ZIP SHA-256: {release_hash}")


if __name__ == "__main__":
    try:
        main()
    except (KeyError, ValueError, RuntimeError, zipfile.BadZipFile, UnicodeDecodeError) as error:
        print(f"WordPress installer acceptance failed: {error}", file=sys.stderr)
        sys.exit(1)
