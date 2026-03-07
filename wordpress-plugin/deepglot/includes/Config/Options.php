<?php

namespace Deepglot\Config;

class Options
{
    public const OPTION_KEY = 'deepglot_settings';

    public static function defaults(): array
    {
        return [
            'enabled' => false,
            'api_base_url' => 'https://deepglot-five.vercel.app/api',
            'api_key' => '',
            'source_language' => 'de',
            'target_languages' => ['en'],
            'auto_redirect' => false,
            'exclude_urls' => '',
            'exclude_selectors' => '',
        ];
    }

    public function all(): array
    {
        $stored = get_option(self::OPTION_KEY, []);

        if (!is_array($stored)) {
            $stored = [];
        }

        return wp_parse_args($stored, self::defaults());
    }

    public function sanitize($input): array
    {
        $input = is_array($input) ? $input : [];

        $targetLanguages = $this->normalizeLanguageList($input['target_languages'] ?? []);

        return [
            'enabled' => !empty($input['enabled']),
            'api_base_url' => untrailingslashit(esc_url_raw((string) ($input['api_base_url'] ?? self::defaults()['api_base_url']))),
            'api_key' => sanitize_text_field((string) ($input['api_key'] ?? '')),
            'source_language' => $this->sanitizeLanguage((string) ($input['source_language'] ?? 'de')),
            'target_languages' => $targetLanguages,
            'auto_redirect' => !empty($input['auto_redirect']),
            'exclude_urls' => sanitize_textarea_field((string) ($input['exclude_urls'] ?? '')),
            'exclude_selectors' => sanitize_textarea_field((string) ($input['exclude_selectors'] ?? '')),
        ];
    }

    public function getApiBaseUrl(): string
    {
        $options = $this->all();

        return $options['api_base_url'];
    }

    public function getApiKey(): string
    {
        $options = $this->all();

        return $options['api_key'];
    }

    public function getSourceLanguage(): string
    {
        $options = $this->all();

        return $options['source_language'];
    }

    public function getTargetLanguages(): array
    {
        $options = $this->all();

        return $options['target_languages'];
    }

    public function isEnabled(): bool
    {
        $options = $this->all();

        return (bool) $options['enabled'];
    }

    public function isConfigured(): bool
    {
        $options = $this->all();

        return !empty($options['api_key']) && !empty($options['target_languages']);
    }

    private function normalizeLanguageList($value): array
    {
        if (is_string($value)) {
            $value = preg_split('/[\s,]+/', $value, -1, PREG_SPLIT_NO_EMPTY);
        }

        if (!is_array($value)) {
            return [];
        }

        $languages = [];

        foreach ($value as $language) {
            $language = $this->sanitizeLanguage((string) $language);

            if ($language !== '') {
                $languages[] = $language;
            }
        }

        return array_values(array_unique($languages));
    }

    private function sanitizeLanguage(string $language): string
    {
        $language = strtolower(trim($language));
        $language = preg_replace('/[^a-z-]/', '', $language);

        return $language ?: '';
    }
}
