#!/usr/bin/env bash
# Builds the distributable wordpress.org plugin ZIP from wordpress-plugin/deepglot.
# Excludes development-only files (tests, QA notes, OS cruft).
#
# Usage: ./build-zip.sh [output-dir]   (default: ./dist)

set -euo pipefail

cd "$(dirname "$0")"

VERSION=$(sed -n "s/^define('DEEPGLOT_PLUGIN_VERSION', '\([^']*\)');$/\1/p" deepglot/deepglot.php)
OUT_DIR="${1:-dist}"
OUT="$OUT_DIR/deepglot-$VERSION.zip"

if [ -z "$VERSION" ]; then
    echo "Could not determine plugin version from deepglot/deepglot.php" >&2
    exit 1
fi

mkdir -p "$OUT_DIR"
rm -f "$OUT"

zip -r "$OUT" deepglot \
    -x "deepglot/tests/*" \
    -x "deepglot/DYNAMIC_TRANSLATION_QA.md" \
    -x "deepglot/.DS_Store" -x "deepglot/*/.DS_Store" -x "deepglot/*/*/.DS_Store" \
    > /dev/null

echo "Built $OUT"
unzip -l "$OUT" | tail -1
