<?php

namespace Deepglot\Support;

/**
 * Thin wrapper around WordPress transients for caching translated texts.
 * Cache key: sha1(sourceLang + targetLang + original text), prefixed with "dg_".
 * TTL: 30 days by default (translations change infrequently).
 */
class TranslationCache
{
    /** Prefix for pre-envelope plain-string values. */
    private const LEGACY_PREFIX = 'dg_';
    /** Prefix for versioned, ASCII-safe envelope values. */
    private const ENVELOPE_KEY_PREFIX = 'dgv1_';
    private const TTL    = 30 * DAY_IN_SECONDS;
    /**
     * ASCII-only transient payload marker. Keeping this distinct from ordinary
     * translations lets existing plain-string cache entries remain readable.
     */
    private const ENVELOPE_PREFIX = 'deepglot-cache:';
    private const ENVELOPE_VERSION = 'v1';

    /**
     * Returns the cached translation or null if not found.
     */
    public function get(string $text, string $sourceLang, string $targetLang): ?string
    {
        $envelopeKey = $this->envelopeKey($text, $sourceLang, $targetLang);
        $value = get_transient($envelopeKey);

        if ($value !== false) {
            return is_string($value) ? $this->decodeEnvelope($value, $envelopeKey) : null;
        }

        // Only a missing versioned key may fall back to the legacy plain
        // string. A malformed versioned value must never downgrade to it.
        $legacyValue = get_transient($this->legacyKey($text, $sourceLang, $targetLang));

        return is_string($legacyValue) ? $legacyValue : null;
    }

    /**
     * Stores a translation in the cache.
     *
     * @return bool Whether the exact versioned value is durably readable.
     */
    public function set(string $text, string $sourceLang, string $targetLang, string $translated): bool
    {
        $key = $this->envelopeKey($text, $sourceLang, $targetLang);
        $envelope = $this->encodeEnvelope($translated, $key);

        if (set_transient($key, $envelope, self::TTL)) {
            return true;
        }

        // WordPress returns false both on a failed write and when the value
        // was already identical. Treat only an exact readback as durable.
        return get_transient($key) === $envelope;
    }

    /**
     * Returns cached translations for a batch of texts.
     * Returns an associative array indexed by the original text.
     * Missing entries are simply absent from the result.
     *
     * @param  string[] $texts
     * @return array<string, string>
     */
    public function getMany(array $texts, string $sourceLang, string $targetLang): array
    {
        $hits = [];

        foreach ($texts as $text) {
            $cached = $this->get($text, $sourceLang, $targetLang);

            if ($cached !== null) {
                $hits[$text] = $cached;
            }
        }

        return $hits;
    }

    /**
     * Stores a batch of translations.
     *
     * @param array<string, string> $translations original => translated
     * @return array<string, bool> original => durable write result
     */
    public function setMany(array $translations, string $sourceLang, string $targetLang): array
    {
        $results = [];

        foreach ($translations as $original => $translated) {
            $results[$original] = $this->set($original, $sourceLang, $targetLang, $translated);
        }

        return $results;
    }

    /**
     * Invalidates all Deepglot transients.
     * Note: WordPress does not support wildcard deletion; we tag keys in options instead.
     */
    public function flush(): void
    {
        global $wpdb;

        // phpcs:ignore WordPress.DB.DirectDatabaseQuery
        $wpdb->query(
            $wpdb->prepare(
                "DELETE FROM {$wpdb->options} WHERE option_name LIKE %s OR option_name LIKE %s OR option_name LIKE %s OR option_name LIKE %s",
                '_transient_' . self::LEGACY_PREFIX . '%',
                '_transient_timeout_' . self::LEGACY_PREFIX . '%',
                '_transient_' . self::ENVELOPE_KEY_PREFIX . '%',
                '_transient_timeout_' . self::ENVELOPE_KEY_PREFIX . '%'
            )
        );
    }

    private function legacyKey(string $text, string $sourceLang, string $targetLang): string
    {
        return self::LEGACY_PREFIX . sha1($sourceLang . '|' . $targetLang . '|' . $text);
    }

    private function envelopeKey(string $text, string $sourceLang, string $targetLang): string
    {
        return self::ENVELOPE_KEY_PREFIX . sha1($sourceLang . '|' . $targetLang . '|' . $text);
    }

    /**
     * Encodes a translation for databases with legacy three-byte UTF-8
     * transient tables. The raw translation is never written directly.
     */
    private function encodeEnvelope(string $translated, string $key): string
    {
        $payload = $this->base64UrlEncode($translated);

        return self::ENVELOPE_PREFIX
            . self::ENVELOPE_VERSION
            . ':'
            . $payload
            . ':'
            . hash('sha256', $key . "\0" . $translated);
    }

    /**
     * Returns null for malformed, corrupted, or unsupported envelope values.
     * This deliberately never deserializes cache data.
     */
    private function decodeEnvelope(string $value, string $key): ?string
    {
        $parts = explode(':', $value);

        if (
            count($parts) !== 4
            || $parts[0] !== rtrim(self::ENVELOPE_PREFIX, ':')
            || $parts[1] !== self::ENVELOPE_VERSION
            || !preg_match('/^[A-Za-z0-9_-]*$/D', $parts[2])
            || !preg_match('/^[a-f0-9]{64}$/D', $parts[3])
        ) {
            return null;
        }

        $payload = $parts[2];
        $remainder = strlen($payload) % 4;

        if ($remainder === 1) {
            return null;
        }

        $decoded = base64_decode(
            strtr($payload, '-_', '+/') . str_repeat('=', (4 - $remainder) % 4),
            true
        );

        if (
            $decoded === false
            || !hash_equals($payload, $this->base64UrlEncode($decoded))
            || !hash_equals($parts[3], hash('sha256', $key . "\0" . $decoded))
        ) {
            return null;
        }

        return $decoded;
    }

    private function base64UrlEncode(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }
}
