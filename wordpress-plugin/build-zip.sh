#!/usr/bin/env bash

# Build a Deepglot WordPress release from one exact commit. The worktree is
# never read for package contents, and the allowlist excludes tests and QA
# material by construction.

set -euo pipefail

usage() {
    printf 'Usage: %s <full-commit-sha> <output-directory>\n' "${0##*/}" >&2
}

if [[ $# -ne 2 ]]; then
    usage
    exit 64
fi

commit="$1"
output_directory="$2"

if [[ ! "$commit" =~ ^[0-9a-f]{40}$ ]]; then
    printf 'Commit must be a full 40-character lowercase SHA-1.\n' >&2
    exit 64
fi

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
repository_root="$(git -C "$script_directory" rev-parse --show-toplevel)"
resolved_commit="$(git -C "$repository_root" rev-parse --verify "$commit^{commit}" 2>/dev/null || true)"

if [[ "$resolved_commit" != "$commit" ]]; then
    printf 'Commit does not resolve to the exact requested commit object: %s\n' "$commit" >&2
    exit 65
fi

builder_relative_path='wordpress-plugin/build-zip.sh'
builder_path="$script_directory/build-zip.sh"
committed_builder_object="$(git -C "$repository_root" rev-parse --verify "$commit:$builder_relative_path" 2>/dev/null || true)"
current_builder_object="$(git -C "$repository_root" hash-object -- "$builder_path")"

if [[ -z "$committed_builder_object" || "$current_builder_object" != "$committed_builder_object" ]]; then
    printf 'Release builder bytes do not match commit %s.\n' "$commit" >&2
    exit 65
fi

plugin_tree='wordpress-plugin/deepglot'
required_paths=(deepglot.php bootstrap.php LICENSE README.md readme.txt includes assets languages)
archive_paths=(deepglot.php bootstrap.php LICENSE README.md readme.txt includes assets languages)
archive_exclusions=(
    ':(exclude,glob)**/.DS_Store'
    ':(exclude,glob)**/Thumbs.db'
    ':(exclude,glob)**/._*'
)
archive_pathspecs=("${archive_paths[@]}" "${archive_exclusions[@]}")

for required_path in "${required_paths[@]}"; do
    if ! git -C "$repository_root" cat-file -e "$commit:$plugin_tree/$required_path" 2>/dev/null; then
        printf 'Required package path is missing from commit %s: %s\n' "$commit" "$required_path" >&2
        exit 66
    fi
done

package_tree_entries="$(
    git -C "$repository_root" ls-tree -r "$commit:$plugin_tree" -- "${archive_paths[@]}"
)"

while IFS=$'\t' read -r object_metadata archive_entry; do
    case "$archive_entry" in
        .DS_Store|*/.DS_Store|Thumbs.db|*/Thumbs.db|._*|*/._*)
            continue
            ;;
    esac

    read -r object_mode object_type object_id <<< "$object_metadata"

    if [[ "$object_type" != 'blob' || ( "$object_mode" != '100644' && "$object_mode" != '100755' ) ]]; then
        printf 'Unsupported Git mode or type in package allowlist: %s %s %s (%s)\n' \
            "$object_mode" "$object_type" "$object_id" "$archive_entry" >&2
        exit 67
    fi
done <<< "$package_tree_entries"

version="$(
    git -C "$repository_root" show "$commit:$plugin_tree/deepglot.php" |
        awk '/^ \* Version:/ { sub(/^ \* Version:[[:space:]]*/, ""); value=$0 } END { print value }'
)"

if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    printf 'Could not read a semantic plugin version from commit %s.\n' "$commit" >&2
    exit 66
fi

sha256_utility=''
sha256_mode=''

if command -v sha256sum >/dev/null 2>&1; then
    sha256_utility="$(command -v sha256sum)"
    sha256_mode='sha256sum'
elif command -v shasum >/dev/null 2>&1; then
    sha256_utility="$(command -v shasum)"
    sha256_mode='shasum'
else
    printf 'A SHA-256 utility (sha256sum or shasum) is required.\n' >&2
    exit 69
fi

remove_utility="$(command -v rm || true)"
if [[ -z "$remove_utility" ]]; then
    printf 'The rm utility is required for release artifact cleanup.\n' >&2
    exit 69
fi

rmdir_utility="$(command -v rmdir || true)"
if [[ -z "$rmdir_utility" ]]; then
    printf 'The rmdir utility is required for release lock cleanup.\n' >&2
    exit 69
fi

commit_epoch="$(git -C "$repository_root" show -s --format=%ct "$commit")"
mkdir -p -- "$output_directory"
output_directory="$(cd -- "$output_directory" && pwd -P)"
archive_name="deepglot-$version.zip"
archive_path="$output_directory/$archive_name"
checksum_path="$archive_path.sha256"
lock_directory="$output_directory/.deepglot-$version.lock"
temporary_archive=''
temporary_checksum=''
archive_created=0
checksum_created=0
lock_owned=0

remove_owned_release_files() {
    if [[ -n "$temporary_archive" ]]; then
        "$remove_utility" -f -- "$temporary_archive" || true
    fi
    if [[ -n "$temporary_checksum" ]]; then
        "$remove_utility" -f -- "$temporary_checksum" || true
    fi
    if [[ $checksum_created -eq 1 ]]; then
        "$remove_utility" -f -- "$checksum_path" || true
    fi
    if [[ $archive_created -eq 1 ]]; then
        "$remove_utility" -f -- "$archive_path" || true
    fi
}

cleanup_release_artifacts() {
    local exit_status=$?
    trap - EXIT

    if [[ $lock_owned -eq 1 ]]; then
        if [[ $exit_status -ne 0 ]]; then
            remove_owned_release_files
        fi

        if ! "$rmdir_utility" "$lock_directory"; then
            printf 'Could not remove release lock directory: %s\n' "$lock_directory" >&2
            if [[ $exit_status -eq 0 ]]; then
                remove_owned_release_files
                exit_status=74
            fi
        fi
    fi

    exit "$exit_status"
}

if ! mkdir -- "$lock_directory" 2>/dev/null; then
    printf 'Another release build holds the version lock: %s\n' "$lock_directory" >&2
    exit 75
fi
lock_owned=1
trap cleanup_release_artifacts EXIT

if [[ -e "$archive_path" || -e "$checksum_path" ]]; then
    printf 'Refusing to overwrite an existing release artifact in %s.\n' "$output_directory" >&2
    exit 73
fi

temporary_archive="$(mktemp "$output_directory/.deepglot-$version.zip.XXXXXX")"

TZ=UTC git -C "$repository_root" archive \
    --format=zip \
    -9 \
    --mtime="@$commit_epoch" \
    --prefix='deepglot/' \
    --output="$temporary_archive" \
    "$commit:$plugin_tree" \
    -- \
    "${archive_pathspecs[@]}"

mv -- "$temporary_archive" "$archive_path"
temporary_archive=''
archive_created=1

if [[ "$sha256_mode" == 'shasum' ]]; then
    archive_hash="$("$sha256_utility" -a 256 "$archive_path" | awk '{ print $1 }')"
else
    archive_hash="$("$sha256_utility" "$archive_path" | awk '{ print $1 }')"
fi
if [[ ! "$archive_hash" =~ ^[0-9a-f]{64}$ ]]; then
    printf 'SHA-256 utility returned an invalid digest.\n' >&2
    exit 69
fi

temporary_checksum="$(mktemp "$output_directory/.deepglot-$version.zip.sha256.XXXXXX")"
printf '%s  %s\n' "$archive_hash" "$archive_name" > "$temporary_checksum"
mv -- "$temporary_checksum" "$checksum_path"
temporary_checksum=''
checksum_created=1

printf 'Built %s\n' "$archive_path"
printf 'SHA-256 %s\n' "$archive_hash"
