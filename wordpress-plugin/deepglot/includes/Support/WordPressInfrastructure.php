<?php

namespace Deepglot\Support;

final class WordPressInfrastructure
{
    /**
     * Exact WordPress routing segments that must never be repurposed as
     * translated content slugs. Keep this list aligned with
     * src/lib/runtime-url-slugs.ts.
     */
    private const RESERVED_SLUG_SEGMENTS = [
        'wp-json',
        'wp-admin',
        'wp-content',
        'wp-includes',
        'wp-login.php',
        'wp-cron.php',
        'xmlrpc.php',
        'wp-comments-post.php',
        'wp-mail.php',
        'wp-trackback.php',
        'wp-signup.php',
        'wp-activate.php',
        'wp-links-opml.php',
    ];

    public static function isReservedSlugSegment(string $segment): bool
    {
        $decoded = rawurldecode(trim($segment));
        $decoded = function_exists('mb_strtolower')
            ? mb_strtolower($decoded, 'UTF-8')
            : strtolower($decoded);

        return in_array($decoded, self::RESERVED_SLUG_SEGMENTS, true);
    }

    /**
     * @param string[] $segments
     */
    public static function isInfrastructurePath(array $segments): bool
    {
        $firstSegment = (string) ($segments[0] ?? '');

        if (strtolower(rawurldecode(trim($firstSegment))) === 'index.php' && isset($segments[1])) {
            $firstSegment = (string) $segments[1];
        }

        return self::isReservedSlugSegment($firstSegment);
    }
}
