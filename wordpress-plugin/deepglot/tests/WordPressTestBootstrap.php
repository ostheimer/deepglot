<?php

/**
 * Minimal WordPress function surface for standalone plugin unit tests.
 */

if (!defined('ABSPATH')) {
    define('ABSPATH', dirname(__DIR__) . DIRECTORY_SEPARATOR);
}

if (!function_exists('wp_parse_url')) {
    function wp_parse_url(string $url, int $component = -1): array|int|string|null|false
    {
        return parse_url($url, $component);
    }
}
