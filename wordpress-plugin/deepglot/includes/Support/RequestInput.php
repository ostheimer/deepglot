<?php

namespace Deepglot\Support;

defined('ABSPATH') || exit;

final class RequestInput
{
    public static function server(string $key, string $default = ''): string
    {
        if (!isset($_SERVER[$key])) {
            return $default;
        }

        // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.MissingUnslash,WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- The value is type-checked, unslashed, and sanitized immediately below.
        $value = $_SERVER[$key];
        if (!is_scalar($value)) {
            return $default;
        }

        if ($key === 'REQUEST_URI' && function_exists('esc_url_raw') && function_exists('wp_unslash')) {
            return esc_url_raw(wp_unslash((string) $value));
        }

        if (function_exists('sanitize_text_field') && function_exists('wp_unslash')) {
            return sanitize_text_field(wp_unslash((string) $value));
        }

        return trim((string) $value);
    }

    public static function query(string $key, string $default = ''): string
    {
        // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only public request routing; this does not change state.
        if (!isset($_GET[$key])) {
            return $default;
        }

        // phpcs:ignore WordPress.Security.NonceVerification.Recommended,WordPress.Security.ValidatedSanitizedInput.MissingUnslash,WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- The value is type-checked, unslashed, and sanitized immediately below.
        $value = $_GET[$key];
        if (!is_scalar($value)) {
            return $default;
        }

        if (function_exists('sanitize_text_field') && function_exists('wp_unslash')) {
            return sanitize_text_field(wp_unslash((string) $value));
        }

        return trim((string) $value);
    }

    public static function hasQuery(string $key): bool
    {
        // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only public request routing; this does not change state.
        return isset($_GET[$key]);
    }
}
