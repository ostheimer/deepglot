<?php

namespace Deepglot\Config;

class Options
{
    public const OPTION_KEY = 'deepglot_settings';

    public static function defaults(): array
    {
        return [
            'enabled' => false,
            'api_base_url' => 'https://deepglot.ai/api',
            'api_key' => '',
            'source_language' => 'de',
            'target_languages' => ['en'],
            'auto_redirect' => false,
            'routing_mode' => 'PATH_PREFIX',
            'domain_mappings' => [],
            'translate_emails' => false,
            'translate_search' => false,
            'translate_amp' => false,
            'exclude_urls' => '',
            'exclude_regexes' => '',
            'exclude_selectors' => '',
            'runtime_config_synced_at' => 0,
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
            'routing_mode' => $this->sanitizeRoutingMode((string) ($input['routing_mode'] ?? 'PATH_PREFIX')),
            'domain_mappings' => $this->normalizeDomainMappings($input['domain_mappings'] ?? []),
            'translate_emails' => !empty($input['translate_emails']),
            'translate_search' => !empty($input['translate_search']),
            'translate_amp' => !empty($input['translate_amp']),
            'exclude_urls' => sanitize_textarea_field((string) ($input['exclude_urls'] ?? '')),
            'exclude_regexes' => sanitize_textarea_field((string) ($input['exclude_regexes'] ?? '')),
            'exclude_selectors' => sanitize_textarea_field((string) ($input['exclude_selectors'] ?? '')),
            'runtime_config_synced_at' => max(0, (int) ($input['runtime_config_synced_at'] ?? 0)),
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

    public function getRoutingMode(): string
    {
        $options = $this->all();

        return $options['routing_mode'];
    }

    public function getDomainMappings(): array
    {
        $options = $this->all();

        return is_array($options['domain_mappings']) ? $options['domain_mappings'] : [];
    }

    public function shouldAutoRedirect(): bool
    {
        $options = $this->all();

        return (bool) $options['auto_redirect'];
    }

    public function shouldTranslateEmails(): bool
    {
        $options = $this->all();

        return (bool) $options['translate_emails'];
    }

    public function shouldTranslateSearch(): bool
    {
        $options = $this->all();

        return (bool) $options['translate_search'];
    }

    public function shouldTranslateAmp(): bool
    {
        $options = $this->all();

        return (bool) $options['translate_amp'];
    }

    /**
     * @return string[]
     */
    public function getExcludedUrlPatterns(): array
    {
        $options = $this->all();

        return $this->lines((string) ($options['exclude_urls'] ?? ''));
    }

    /**
     * @return string[]
     */
    public function getExcludedRegexPatterns(): array
    {
        $options = $this->all();

        return $this->lines((string) ($options['exclude_regexes'] ?? ''));
    }

    /**
     * @return string[]
     */
    public function getExcludedSelectors(): array
    {
        $options = $this->all();

        return $this->lines((string) ($options['exclude_selectors'] ?? ''));
    }

    public function getRuntimeConfigSyncedAt(): int
    {
        $options = $this->all();

        return max(0, (int) ($options['runtime_config_synced_at'] ?? 0));
    }

    public function shouldRefreshRuntimeConfig(int $intervalSeconds = 300): bool
    {
        return time() - $this->getRuntimeConfigSyncedAt() >= $intervalSeconds;
    }

    public function applyRuntimeConfig(array $runtimeConfig): bool
    {
        $exclusions = is_array($runtimeConfig['exclusions'] ?? null)
            ? $runtimeConfig['exclusions']
            : [];

        $settings = $this->all();
        $settings['exclude_urls'] = implode("\n", $this->normalizeStringList($exclusions['urls'] ?? []));
        $settings['exclude_regexes'] = implode("\n", $this->normalizeStringList($exclusions['regexes'] ?? []));
        $settings['exclude_selectors'] = implode("\n", $this->normalizeStringList($exclusions['selectors'] ?? []));
        $settings['runtime_config_synced_at'] = time();

        $GLOBALS['deepglot_applying_runtime_config'] = true;
        $updated = update_option(self::OPTION_KEY, $settings);
        unset($GLOBALS['deepglot_applying_runtime_config']);

        return (bool) $updated;
    }

    public function isUrlExcluded(string $urlOrPath): bool
    {
        $candidates = $this->urlCandidates($urlOrPath);

        foreach ($this->getExcludedUrlPatterns() as $pattern) {
            if ($this->matchesUrlPattern($candidates, $pattern)) {
                return true;
            }
        }

        foreach ($this->getExcludedRegexPatterns() as $pattern) {
            if ($this->matchesRegexPattern($candidates, $pattern)) {
                return true;
            }
        }

        return false;
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

    private function sanitizeRoutingMode(string $routingMode): string
    {
        $routingMode = strtoupper(trim($routingMode));

        return $routingMode === 'SUBDOMAIN' ? 'SUBDOMAIN' : 'PATH_PREFIX';
    }

    private function normalizeDomainMappings($value): array
    {
        if (is_string($value)) {
            $lines = preg_split('/\r?\n/', $value) ?: [];
            $value = [];

            foreach ($lines as $line) {
                $line = trim($line);
                if ($line === '' || strpos($line, '=') === false) {
                    continue;
                }

                [$lang, $host] = array_map('trim', explode('=', $line, 2));
                $value[$lang] = $host;
            }
        }

        if (!is_array($value)) {
            return [];
        }

        $mappings = [];

        foreach ($value as $lang => $host) {
            $language = $this->sanitizeLanguage((string) $lang);
            $normalizedHost = $this->sanitizeHost((string) $host);

            if ($language !== '' && $normalizedHost !== '') {
                $mappings[$language] = $normalizedHost;
            }
        }

        return $mappings;
    }

    private function sanitizeHost(string $host): string
    {
        $host = strtolower(trim($host));
        $host = preg_replace('#^https?://#', '', $host);
        $host = trim((string) parse_url('https://' . $host, PHP_URL_HOST));

        return $host ?: '';
    }

    /**
     * @return string[]
     */
    private function lines(string $value): array
    {
        return $this->normalizeStringList(preg_split('/\r?\n/', $value) ?: []);
    }

    /**
     * @param mixed $value
     * @return string[]
     */
    private function normalizeStringList($value): array
    {
        if (is_string($value)) {
            $value = preg_split('/\r?\n/', $value) ?: [];
        }

        if (!is_array($value)) {
            return [];
        }

        $items = [];

        foreach ($value as $item) {
            $item = trim((string) $item);

            if ($item !== '') {
                $items[] = $item;
            }
        }

        return array_values(array_unique($items));
    }

    /**
     * @return string[]
     */
    private function urlCandidates(string $urlOrPath): array
    {
        $urlOrPath = trim($urlOrPath);

        if ($urlOrPath === '') {
            return [];
        }

        $candidates = [$urlOrPath];
        $path = parse_url($urlOrPath, PHP_URL_PATH);
        $query = parse_url($urlOrPath, PHP_URL_QUERY);

        if (is_string($path) && $path !== '') {
            $candidates[] = $path;
            $candidates[] = $query ? $path . '?' . $query : $path;
        }

        return array_values(array_unique($candidates));
    }

    /**
     * @param string[] $candidates
     */
    private function matchesUrlPattern(array $candidates, string $pattern): bool
    {
        $pattern = trim($pattern);

        if ($pattern === '') {
            return false;
        }

        if (str_contains($pattern, '*')) {
            $regex = '#' . str_replace('\\*', '.*', preg_quote($pattern, '#')) . '#';

            foreach ($candidates as $candidate) {
                if (preg_match($regex, $candidate) === 1) {
                    return true;
                }
            }

            return false;
        }

        foreach ($candidates as $candidate) {
            if ($candidate === $pattern || str_contains($candidate, $pattern)) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param string[] $candidates
     */
    private function matchesRegexPattern(array $candidates, string $pattern): bool
    {
        $pattern = trim($pattern);

        if ($pattern === '') {
            return false;
        }

        foreach ($candidates as $candidate) {
            $result = @preg_match('#' . str_replace('#', '\\#', $pattern) . '#', $candidate);

            if ($result === 1) {
                return true;
            }
        }

        return false;
    }
}
