<?php

namespace Deepglot\Config;

class Options
{
    public const OPTION_KEY = 'deepglot_settings';

    /** Allowed values for `switcher_default_style`. */
    public const SWITCHER_STYLES = ['list', 'dropdown'];

    /**
     * Allowed values for `switcher_flag_style`. Mirrors the Project →
     * Switcher panel options on the SaaS dashboard so two-way sync stays
     * unambiguous.
     */
    public const SWITCHER_FLAG_STYLES = [
        'rectangle_mat',
        'rectangle_glossy',
        'circle_mat',
        'circle_glossy',
        'none',
    ];

    /** Allowed values for `switcher_label_format`. */
    public const SWITCHER_LABEL_FORMATS = ['full_name', 'iso_code'];

    /**
     * Allowed values for `switcher_position`. `inline` (default) keeps the
     * Weglot-compatible drop-anywhere behaviour; the four `fixed-*` slots
     * pin the switcher to a viewport corner via CSS `position: fixed` so
     * auto-inject can deliver the floating-button UX that Weglot ships as
     * default.
     */
    public const SWITCHER_POSITIONS = [
        'inline',
        'fixed-bottom-right',
        'fixed-bottom-left',
        'fixed-top-right',
        'fixed-top-left',
    ];

    /** Allowed values for `switcher_responsive_hide`. */
    public const SWITCHER_RESPONSIVE_HIDE_VALUES = ['none', 'mobile', 'desktop'];

    /** Clamp range for `switcher_responsive_breakpoint` (px). */
    public const SWITCHER_BREAKPOINT_MIN     = 320;
    public const SWITCHER_BREAKPOINT_MAX     = 1920;
    public const SWITCHER_BREAKPOINT_DEFAULT = 768;

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
            // Client-side translation of content added after page load (AJAX,
            // infinite scroll, SPA widgets). Opt-in: the server-side pass keeps
            // handling the initial, crawlable HTML on its own.
            'enable_dynamic_translation' => false,
            'exclude_urls' => '',
            'exclude_regexes' => '',
            'exclude_selectors' => '',
            'runtime_config_synced_at' => 0,
            // Language-switcher appearance & placement. All opt-in: existing
            // sites keep their shortcode / theme integration untouched until
            // the admin explicitly enables auto-inject or customises styles.
            'switcher_auto_inject' => false,
            'switcher_default_style' => 'list',
            'switcher_flag_style' => 'rectangle_mat',
            'switcher_show_label' => true,
            'switcher_label_format' => 'full_name',
            'switcher_language_order' => [],
            'switcher_custom_css' => '',
            'switcher_position' => 'inline',
            'switcher_responsive_hide' => 'none',
            'switcher_responsive_breakpoint' => self::SWITCHER_BREAKPOINT_DEFAULT,
            // Per-language flag overrides: assoc array<lang, emoji|url>.
            // Empty by default → render keeps the canonical default flag
            // per language (e.g. `en` → 🇬🇧). Admin can override for
            // regional audiences (`en` → 🇺🇸).
            'switcher_custom_flags' => [],
        ];
    }

    /** Max characters per custom flag value — caps inline CSS size. */
    public const SWITCHER_CUSTOM_FLAG_MAX_LEN = 256;

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
            'enable_dynamic_translation' => !empty($input['enable_dynamic_translation']),
            'exclude_urls' => sanitize_textarea_field((string) ($input['exclude_urls'] ?? '')),
            'exclude_regexes' => sanitize_textarea_field((string) ($input['exclude_regexes'] ?? '')),
            'exclude_selectors' => sanitize_textarea_field((string) ($input['exclude_selectors'] ?? '')),
            'runtime_config_synced_at' => max(0, (int) ($input['runtime_config_synced_at'] ?? 0)),
            'switcher_auto_inject' => !empty($input['switcher_auto_inject']),
            'switcher_default_style' => $this->sanitizeEnum(
                (string) ($input['switcher_default_style'] ?? 'list'),
                self::SWITCHER_STYLES,
                'list'
            ),
            'switcher_flag_style' => $this->sanitizeEnum(
                (string) ($input['switcher_flag_style'] ?? 'rectangle_mat'),
                self::SWITCHER_FLAG_STYLES,
                'rectangle_mat'
            ),
            'switcher_show_label' => !empty($input['switcher_show_label']),
            'switcher_label_format' => $this->sanitizeEnum(
                (string) ($input['switcher_label_format'] ?? 'full_name'),
                self::SWITCHER_LABEL_FORMATS,
                'full_name'
            ),
            'switcher_language_order' => $this->normalizeLanguageList($input['switcher_language_order'] ?? []),
            'switcher_custom_css' => trim((string) ($input['switcher_custom_css'] ?? '')),
            'switcher_position' => $this->sanitizeEnum(
                (string) ($input['switcher_position'] ?? 'inline'),
                self::SWITCHER_POSITIONS,
                'inline'
            ),
            'switcher_responsive_hide' => $this->sanitizeEnum(
                (string) ($input['switcher_responsive_hide'] ?? 'none'),
                self::SWITCHER_RESPONSIVE_HIDE_VALUES,
                'none'
            ),
            'switcher_responsive_breakpoint' => $this->sanitizeBreakpoint(
                $input['switcher_responsive_breakpoint'] ?? self::SWITCHER_BREAKPOINT_DEFAULT
            ),
            'switcher_custom_flags' => $this->sanitizeCustomFlags(
                $input['switcher_custom_flags'] ?? [],
                $this->sanitizeLanguage((string) ($input['source_language'] ?? 'de')),
                $targetLanguages
            ),
        ];
    }

    /**
     * Clamp a px breakpoint into [320, 1920]. Non-numeric input falls
     * back to the documented default (768) so a typo in the admin form
     * can't hide the switcher on every viewport.
     *
     * @param mixed $value
     */
    private function sanitizeBreakpoint($value): int
    {
        if (!is_numeric($value)) {
            return self::SWITCHER_BREAKPOINT_DEFAULT;
        }
        $px = (int) $value;
        if ($px < self::SWITCHER_BREAKPOINT_MIN) return self::SWITCHER_BREAKPOINT_MIN;
        if ($px > self::SWITCHER_BREAKPOINT_MAX) return self::SWITCHER_BREAKPOINT_MAX;
        return $px;
    }

    /**
     * Filter custom flag overrides down to:
     *   - keys that are valid ISO language codes AND part of the
     *     configured (source ∪ targets) language set
     *   - values that are non-empty, under SWITCHER_CUSTOM_FLAG_MAX_LEN
     *     chars, and free of CSS string break-out characters (`"`, `'`,
     *     `;`, `{`, `}`, `<`)
     *
     * @param mixed   $value
     * @param string  $sourceLang
     * @param string[] $targetLangs
     * @return array<string,string>
     */
    private function sanitizeCustomFlags($value, string $sourceLang, array $targetLangs): array
    {
        if (!is_array($value)) {
            return [];
        }

        $configured = array_flip(array_merge([$sourceLang], $targetLangs));
        $clean = [];

        foreach ($value as $lang => $flag) {
            $lang = $this->sanitizeLanguage((string) $lang);
            if ($lang === '' || !isset($configured[$lang])) {
                continue;
            }

            $flag = trim((string) $flag);
            if ($flag === '') {
                continue;
            }

            // Strip characters that could break out of a CSS string or
            // url() context. Real flag values (emoji or https URLs)
            // never need any of these characters.
            $flag = str_replace(['"', "'", ';', '{', '}', '<', '>', '\\'], '', $flag);

            if (mb_strlen($flag) > self::SWITCHER_CUSTOM_FLAG_MAX_LEN) {
                $flag = mb_substr($flag, 0, self::SWITCHER_CUSTOM_FLAG_MAX_LEN);
            }

            if ($flag !== '') {
                $clean[$lang] = $flag;
            }
        }

        return $clean;
    }

    private function sanitizeEnum(string $value, array $allowed, string $default): string
    {
        $normalized = strtolower(trim($value));
        return in_array($normalized, $allowed, true) ? $normalized : $default;
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
     * Whether the client-side dynamic-content translator is enabled. Opt-in;
     * gates both the front-end asset and the /translate-dynamic REST endpoint.
     */
    public function shouldTranslateDynamicContent(): bool
    {
        $options = $this->all();

        return (bool) ($options['enable_dynamic_translation'] ?? false);
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

    public function shouldAutoInjectSwitcher(): bool
    {
        $options = $this->all();
        return (bool) ($options['switcher_auto_inject'] ?? false);
    }

    public function getSwitcherDefaultStyle(): string
    {
        $options = $this->all();
        $value = strtolower(trim((string) ($options['switcher_default_style'] ?? 'list')));
        return in_array($value, self::SWITCHER_STYLES, true) ? $value : 'list';
    }

    public function getSwitcherFlagStyle(): string
    {
        $options = $this->all();
        $value = strtolower(trim((string) ($options['switcher_flag_style'] ?? 'rectangle_mat')));
        return in_array($value, self::SWITCHER_FLAG_STYLES, true) ? $value : 'rectangle_mat';
    }

    public function shouldShowSwitcherLabel(): bool
    {
        $options = $this->all();
        return (bool) ($options['switcher_show_label'] ?? true);
    }

    public function getSwitcherLabelFormat(): string
    {
        $options = $this->all();
        $value = strtolower(trim((string) ($options['switcher_label_format'] ?? 'full_name')));
        return in_array($value, self::SWITCHER_LABEL_FORMATS, true) ? $value : 'full_name';
    }

    /**
     * @return string[]
     */
    public function getSwitcherLanguageOrder(): array
    {
        $options = $this->all();
        $stored = $options['switcher_language_order'] ?? [];
        return $this->normalizeLanguageList($stored);
    }

    public function getSwitcherCustomCss(): string
    {
        $options = $this->all();
        return (string) ($options['switcher_custom_css'] ?? '');
    }

    /**
     * Per-language flag overrides: assoc array<lang, emoji|url>.
     * Already sanitised + scoped to configured languages by sanitize().
     *
     * @return array<string,string>
     */
    public function getSwitcherCustomFlags(): array
    {
        $options = $this->all();
        $stored  = $options['switcher_custom_flags'] ?? [];
        return is_array($stored) ? $stored : [];
    }

    public function getSwitcherPosition(): string
    {
        $options = $this->all();
        $value   = strtolower(trim((string) ($options['switcher_position'] ?? 'inline')));
        return in_array($value, self::SWITCHER_POSITIONS, true) ? $value : 'inline';
    }

    public function getSwitcherResponsiveHide(): string
    {
        $options = $this->all();
        $value   = strtolower(trim((string) ($options['switcher_responsive_hide'] ?? 'none')));
        return in_array($value, self::SWITCHER_RESPONSIVE_HIDE_VALUES, true) ? $value : 'none';
    }

    public function getSwitcherResponsiveBreakpoint(): int
    {
        $options = $this->all();
        return $this->sanitizeBreakpoint($options['switcher_responsive_breakpoint'] ?? self::SWITCHER_BREAKPOINT_DEFAULT);
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

    public function applyRuntimeConfig(array $runtimeConfig, ?string $fetchedWithApiKey = null): bool
    {
        // Evict this request's options cache and re-read before merging: the
        // sync rewrites the WHOLE option, and on a busy site a request that
        // started before an admin save would otherwise write its stale
        // snapshot back and silently revert the admin's change (observed
        // live: enable_dynamic_translation flipped off minutes after being
        // saved). A sub-second write/write race remains theoretically
        // possible, but the realistic minutes-long window is closed.
        if (function_exists('wp_cache_delete')) {
            wp_cache_delete(self::OPTION_KEY, 'options');
            wp_cache_delete('alloptions', 'options');
        }

        $settings = $this->all();

        // The payload was fetched BEFORE the fresh re-read above. If the admin
        // switched API keys (projects) in between, it belongs to the previous
        // project — discard it instead of merging another project's
        // exclusions/switcher into these settings. The sync timestamp stays
        // untouched, so the next refresh retries with the current key.
        if (
            $fetchedWithApiKey !== null
            && $fetchedWithApiKey !== (string) ($settings['api_key'] ?? '')
        ) {
            return false;
        }

        // Only overwrite sub-objects the SaaS actually sent. A partial
        // runtime payload (e.g. switcher-only) must not silently clobber
        // exclusion lists that the admin has configured.
        if (array_key_exists('exclusions', $runtimeConfig) && is_array($runtimeConfig['exclusions'])) {
            $exclusions = $runtimeConfig['exclusions'];
            $settings['exclude_urls'] = implode("\n", $this->normalizeStringList($exclusions['urls'] ?? []));
            $settings['exclude_regexes'] = implode("\n", $this->normalizeStringList($exclusions['regexes'] ?? []));
            $settings['exclude_selectors'] = implode("\n", $this->normalizeStringList($exclusions['selectors'] ?? []));
        }

        if (array_key_exists('switcher', $runtimeConfig) && is_array($runtimeConfig['switcher'])) {
            $switcher = $runtimeConfig['switcher'];

            if (array_key_exists('autoInject', $switcher)) {
                $settings['switcher_auto_inject'] = !empty($switcher['autoInject']);
            }
            if (array_key_exists('defaultStyle', $switcher)) {
                $settings['switcher_default_style'] = $this->sanitizeEnum(
                    (string) $switcher['defaultStyle'],
                    self::SWITCHER_STYLES,
                    'list'
                );
            }
            if (array_key_exists('flagStyle', $switcher)) {
                $settings['switcher_flag_style'] = $this->sanitizeEnum(
                    (string) $switcher['flagStyle'],
                    self::SWITCHER_FLAG_STYLES,
                    'rectangle_mat'
                );
            }
            if (array_key_exists('showLabel', $switcher)) {
                $settings['switcher_show_label'] = !empty($switcher['showLabel']);
            }
            if (array_key_exists('labelFormat', $switcher)) {
                $settings['switcher_label_format'] = $this->sanitizeEnum(
                    (string) $switcher['labelFormat'],
                    self::SWITCHER_LABEL_FORMATS,
                    'full_name'
                );
            }
            if (array_key_exists('languageOrder', $switcher)) {
                $settings['switcher_language_order'] = $this->normalizeLanguageList($switcher['languageOrder']);
            }
            if (array_key_exists('customCss', $switcher)) {
                $settings['switcher_custom_css'] = trim((string) $switcher['customCss']);
            }
            if (array_key_exists('position', $switcher)) {
                $settings['switcher_position'] = $this->sanitizeEnum(
                    (string) $switcher['position'],
                    self::SWITCHER_POSITIONS,
                    'inline'
                );
            }
            if (array_key_exists('responsiveHide', $switcher)) {
                $settings['switcher_responsive_hide'] = $this->sanitizeEnum(
                    (string) $switcher['responsiveHide'],
                    self::SWITCHER_RESPONSIVE_HIDE_VALUES,
                    'none'
                );
            }
            if (array_key_exists('responsiveBreakpoint', $switcher)) {
                $settings['switcher_responsive_breakpoint'] = $this->sanitizeBreakpoint($switcher['responsiveBreakpoint']);
            }
            if (array_key_exists('customFlags', $switcher)) {
                $settings['switcher_custom_flags'] = $this->sanitizeCustomFlags(
                    $switcher['customFlags'],
                    (string) ($settings['source_language'] ?? 'de'),
                    is_array($settings['target_languages'] ?? null) ? $settings['target_languages'] : []
                );
            }
        }

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
