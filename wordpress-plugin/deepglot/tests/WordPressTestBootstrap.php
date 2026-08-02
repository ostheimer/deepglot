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

if (!function_exists('wp_unslash')) {
    function wp_unslash(mixed $value): mixed
    {
        return $value;
    }
}

require_once dirname(__DIR__) . '/includes/Support/RequestInput.php';
