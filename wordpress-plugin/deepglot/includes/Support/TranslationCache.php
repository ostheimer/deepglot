<?php

namespace Deepglot\Support;

/**
 * Thin wrapper around WordPress transients for caching translated texts.
 * Cache key: sha1(sourceLang + targetLang + original text), prefixed with "dg_".
 * TTL: 30 days by default (translations change infrequently).
 */
class TranslationCache
{
    private const PREFIX = 'dg_';
    private const TTL    = 30 * DAY_IN_SECONDS;

    /**
     * Returns the cached translation or null if not found.
     */
    public function get(string $text, string $sourceLang, string $targetLang): ?string
    {
        $value = get_transient($this->key($text, $sourceLang, $targetLang));

        return ($value !== false && is_string($value)) ? $value : null;
    }

    /**
     * Stores a translation in the cache.
     */
    public function set(string $text, string $sourceLang, string $targetLang, string $translated): void
    {
        set_transient($this->key($text, $sourceLang, $targetLang), $translated, self::TTL);
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
     * @param array<string, string> $translations  original => translated
     */
    public function setMany(array $translations, string $sourceLang, string $targetLang): void
    {
        foreach ($translations as $original => $translated) {
            $this->set($original, $sourceLang, $targetLang, $translated);
        }
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
                "DELETE FROM {$wpdb->options} WHERE option_name LIKE %s OR option_name LIKE %s",
                '_transient_' . self::PREFIX . '%',
                '_transient_timeout_' . self::PREFIX . '%'
            )
        );
    }

    private function key(string $text, string $sourceLang, string $targetLang): string
    {
        // sha1 produces a 40-char hex string; add prefix + lang codes (max ~50 chars total, well within the 172-char WP limit).
        return self::PREFIX . sha1($sourceLang . '|' . $targetLang . '|' . $text);
    }
}
