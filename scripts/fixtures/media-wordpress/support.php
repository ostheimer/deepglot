<?php
/** Shared restoration and ownership checks for the disposable fixture only. */
if (!defined('WP_CLI') || !WP_CLI) { exit; }

function dg_media_acceptance_restore_cache(array $snapshot): void
{
    foreach ($snapshot as $key => $entry) {
        if ($entry['value'] === false || ($entry['expires'] > 0 && $entry['expires'] <= time())) {
            if (!delete_transient($key) && get_transient($key) !== false) {
                throw new RuntimeException('Cannot remove fixture cache entry: ' . $key);
            }
        } else {
            $ttl = $entry['expires'] > 0 ? max(1, $entry['expires'] - time()) : 0;
            if (!set_transient($key, $entry['value'], $ttl) && get_transient($key) !== $entry['value']) {
                throw new RuntimeException('Cannot restore fixture cache entry: ' . $key);
            }
        }
    }
}

function dg_media_acceptance_owns_url(string $url): bool
{
    $path = parse_url($url, PHP_URL_PATH);
    if (is_string($path) && str_contains($path, '/wp-content/uploads/deepglot-media-acceptance-20260928/')) {
        return true;
    }
    // These fixed synthetic provider IDs belong to the template, even when
    // only an embed mapping remains after the file mappings were removed.
    return in_array($url, [
        'https://www.youtube.com/embed/DgMediaDE01',
        'https://www.youtube.com/embed/DgMediaEN01',
        'https://www.youtube-nocookie.com/embed/DgMediaDE01',
        'https://www.youtube-nocookie.com/embed/DgMediaEN01',
        'https://player.vimeo.com/video/98765432101',
        'https://player.vimeo.com/video/98765432102',
    ], true);
}
