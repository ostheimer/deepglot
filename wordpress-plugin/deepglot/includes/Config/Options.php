<?php

namespace Deepglot\Config;

defined('ABSPATH') || exit;

use Deepglot\Support\WordPressInfrastructure;

require_once dirname(__DIR__) . '/Support/WordPressInfrastructure.php';

class Options
{
    public const OPTION_KEY = 'deepglot_settings';
    public const URL_SLUG_MAPPINGS_OPTION_KEY = 'deepglot_url_slug_mappings';
    public const MEDIA_REPLACEMENTS_OPTION_KEY = 'deepglot_media_replacements';

    /** Current persisted schema for independently configured switchers. */
    public const SWITCHER_INSTANCES_VERSION = 1;

    /** Keep the admin and frontend bounded even for a forged settings POST. */
    public const SWITCHER_INSTANCES_MAX = 20;

    /** Conservative upper bound for visual-editor-generated DOM selectors. */
    public const SWITCHER_SELECTOR_MAX_LEN = 200;

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

    /** Bound SaaS-provided slug maps before persisting them in wp_options. */
    public const URL_SLUG_MAPPINGS_MAX = 10000;
    public const URL_SLUG_MAPPINGS_MAX_BYTES = 2097152;
    public const URL_SLUG_SEGMENT_MAX_LEN = 200;
    public const MEDIA_REPLACEMENTS_MAX = 500;
    public const MEDIA_REPLACEMENTS_MAX_BYTES = 262144;
    public const MEDIA_REPLACEMENT_URL_MAX_LEN = 2048;

    public static function defaults(): array
    {
        return [
            'enabled' => false,
            'api_base_url' => 'https://deepglot.ai/api',
            'api_key' => '',
            'source_language' => 'de',
            'target_languages' => ['en'],
            'visible_target_languages' => null,
            'automatic_target_languages' => null,
            'target_language_generations' => [],
            'auto_redirect' => false,
            // General project runtime values are read back from the authenticated
            // SaaS project. They are preserved across ordinary wp-admin saves and
            // reset when the API key/backend identity changes.
            'display_ai_notice' => false,
            'automatic_translation' => true,
            'saas_project_version' => '',
            'routing_mode' => 'PATH_PREFIX',
            'domain_mappings' => [],
            'translate_emails' => false,
            'translate_search' => false,
            'translate_amp' => false,
            // Client-side translation of content added after page load (AJAX,
            // infinite scroll, SPA widgets). Opt-in: the server-side pass keeps
            // handling the initial, crawlable HTML on its own.
            'enable_dynamic_translation' => false,
            // Dashboard-controlled and deliberately separate from translation
            // generation. Existing and newly connected sites never track until
            // their authenticated runtime configuration explicitly opts in.
            'page_views_enabled' => false,
            'exclude_urls' => '',
            'exclude_regexes' => '',
            'exclude_selectors' => '',
            'runtime_config_synced_at' => 0,
            // Language-switcher appearance & placement. All opt-in: existing
            // sites keep their shortcode / theme integration untouched until
            // the admin explicitly enables auto-inject or customises styles.
            'switcher_auto_inject' => false,
            'switcher_name' => 'Standard',
            'switcher_enabled' => true,
            'switcher_selector' => '',
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
            'switcher_custom_names' => [],
            'switcher_contract_revision' => null,
            'switcher_contract_owner' => 'wordpress',
            'switcher_contract_last_seen' => 0,
            'switcher_contract_config' => [],
            'switcher_local_conflict' => false,
            // Versioned multi-switcher storage. Existing installations are
            // migrated lazily from the global switcher_* fields in all().
            'switcher_instances_version' => self::SWITCHER_INSTANCES_VERSION,
            'switcher_instances' => [],
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

        $settings = wp_parse_args($stored, self::defaults());
        $shouldPersistRuntimeCacheMigration = false;

        if (array_key_exists('url_slug_mappings', $settings)) {
            $dedicatedMappings = get_option(self::URL_SLUG_MAPPINGS_OPTION_KEY, null);

            if (!is_array($dedicatedMappings)) {
                $this->storeUrlSlugMappings($this->normalizeUrlSlugMappings(
                    $settings['url_slug_mappings'],
                    $this->normalizeLanguageList($settings['target_languages'] ?? [])
                ));
            }

            unset($settings['url_slug_mappings']);
            $shouldPersistRuntimeCacheMigration = true;
        }

        $shouldPersistSwitcherMigration = false;
        if (
            !isset($stored['switcher_instances_version'])
            || (int) $stored['switcher_instances_version'] < self::SWITCHER_INSTANCES_VERSION
            || !isset($stored['switcher_instances'])
            || !is_array($stored['switcher_instances'])
            || $stored['switcher_instances'] === []
        ) {
            $settings['switcher_instances_version'] = self::SWITCHER_INSTANCES_VERSION;
            $settings['switcher_instances'] = [$this->legacySwitcherInstance($settings)];

            // Persist once so subsequent requests and rollback/debug tooling see
            // an explicit migration instead of a transient computed default.
            $shouldPersistSwitcherMigration = true;
        }

        if ($shouldPersistRuntimeCacheMigration || $shouldPersistSwitcherMigration) {
            $this->updateSettingsOption($settings, $shouldPersistRuntimeCacheMigration);
        }

        return $settings;
    }

    public function sanitize($input): array
    {
        $input = is_array($input) ? $input : [];

        $incomingApiKey = sanitize_text_field((string) ($input['api_key'] ?? ''));
        $incomingBaseUrl = untrailingslashit(esc_url_raw((string) ($input['api_base_url'] ?? self::defaults()['api_base_url'])));
        $storedSettings = get_option(self::OPTION_KEY, []);
        $storedSettings = is_array($storedSettings) ? $storedSettings : [];
        $storedApiKey = trim((string) ($storedSettings['api_key'] ?? ''));
        $storedBaseUrl = untrailingslashit((string) ($storedSettings['api_base_url'] ?? self::defaults()['api_base_url']));
        $sameRuntimeIdentity = $incomingApiKey !== ''
            && $storedApiKey !== ''
            && hash_equals($storedApiKey, $incomingApiKey)
            && $incomingBaseUrl === $storedBaseUrl;

        // The dashboard owns this project-wide state. The legacy WordPress form
        // still posts these fields, so a normal save must not overwrite a newer
        // authenticated runtime readback. For a new key/backend, keep the form's
        // bootstrap languages until that identity returns its own project state,
        // but discard every value that could have belonged to the old project.
        $sourceLanguage = $sameRuntimeIdentity
            ? $this->sanitizeLanguage((string) ($storedSettings['source_language'] ?? 'de'))
            : $this->sanitizeLanguage((string) ($input['source_language'] ?? 'de'));
        $targetLanguages = $sameRuntimeIdentity
            ? $this->normalizeLanguageList($storedSettings['target_languages'] ?? [])
            : $this->normalizeLanguageList($input['target_languages'] ?? []);
        $visibleTargetLanguages = $sameRuntimeIdentity
            ? array_values(array_intersect($targetLanguages, $this->normalizeLanguageList($storedSettings['visible_target_languages'] ?? $targetLanguages)))
            : $targetLanguages;
        $automaticTargetLanguages = $sameRuntimeIdentity
            ? array_values(array_intersect($targetLanguages, $this->normalizeLanguageList($storedSettings['automatic_target_languages'] ?? $targetLanguages)))
            : $targetLanguages;
        $autoRedirect = $sameRuntimeIdentity
            ? !empty($storedSettings['auto_redirect'])
            : !empty($input['auto_redirect']);
        $displayAiNotice = $sameRuntimeIdentity
            && ($storedSettings['display_ai_notice'] ?? false) === true;
        $automaticTranslation = $sameRuntimeIdentity
            ? ($storedSettings['automatic_translation'] ?? true) === true
            : true;
        $saasProjectVersion = $sameRuntimeIdentity
            ? $this->normalizeSaasProjectVersion($storedSettings['saas_project_version'] ?? '')
            : '';

        // The wp-admin form intentionally has no tracking toggle: consent lives
        // on the SaaS project. Preserve that authoritative runtime value across
        // ordinary saves, but fail closed immediately when project/backend changes.
        $preservePageViewOptIn = $sameRuntimeIdentity
            && !empty($storedSettings['page_views_enabled']);

        $sanitized = [
            'enabled' => !empty($input['enabled']),
            'api_base_url' => $incomingBaseUrl,
            'api_key' => $incomingApiKey,
            'source_language' => $sourceLanguage,
            'target_languages' => $targetLanguages,
            'visible_target_languages' => $visibleTargetLanguages,
            'automatic_target_languages' => $automaticTargetLanguages,
            'target_language_generations' => $sameRuntimeIdentity && is_array($storedSettings['target_language_generations'] ?? null)
                ? $storedSettings['target_language_generations'] : [],
            'auto_redirect' => $autoRedirect,
            'display_ai_notice' => $displayAiNotice,
            'automatic_translation' => $automaticTranslation,
            'saas_project_version' => $saasProjectVersion,
            'routing_mode' => $this->sanitizeRoutingMode((string) ($input['routing_mode'] ?? 'PATH_PREFIX')),
            'domain_mappings' => $this->normalizeDomainMappings($input['domain_mappings'] ?? []),
            'translate_emails' => !empty($input['translate_emails']),
            'translate_search' => !empty($input['translate_search']),
            'translate_amp' => !empty($input['translate_amp']),
            'enable_dynamic_translation' => !empty($input['enable_dynamic_translation']),
            'page_views_enabled' => $preservePageViewOptIn,
            'exclude_urls' => sanitize_textarea_field((string) ($input['exclude_urls'] ?? '')),
            'exclude_regexes' => sanitize_textarea_field((string) ($input['exclude_regexes'] ?? '')),
            'exclude_selectors' => sanitize_textarea_field((string) ($input['exclude_selectors'] ?? '')),
            'runtime_config_synced_at' => max(0, (int) ($input['runtime_config_synced_at'] ?? 0)),
            'switcher_auto_inject' => !empty($input['switcher_auto_inject']),
            'switcher_name' => sanitize_text_field((string) ($input['switcher_name'] ?? 'Standard')),
            'switcher_enabled' => !empty($input['switcher_enabled']),
            'switcher_selector' => $this->sanitizeSwitcherSelector($input['switcher_selector'] ?? ''),
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
            'switcher_custom_names' => $this->sanitizeCustomNames(
                $input['switcher_custom_names'] ?? [],
                $this->sanitizeLanguage((string) ($input['source_language'] ?? 'de')),
                $targetLanguages
            ),
            'switcher_contract_revision' => $sameRuntimeIdentity ? ($storedSettings['switcher_contract_revision'] ?? null) : null,
            'switcher_contract_owner' => $sameRuntimeIdentity ? ($storedSettings['switcher_contract_owner'] ?? 'wordpress') : 'wordpress',
            'switcher_contract_last_seen' => $sameRuntimeIdentity ? max(0, (int) ($storedSettings['switcher_contract_last_seen'] ?? 0)) : 0,
            'switcher_contract_config' => $sameRuntimeIdentity ? ($storedSettings['switcher_contract_config'] ?? []) : [],
            'switcher_local_conflict' => $sameRuntimeIdentity && !empty($storedSettings['switcher_local_conflict']),
        ];

        $sanitized['switcher_instances_version'] = self::SWITCHER_INSTANCES_VERSION;
        $sanitized['switcher_instances'] = $this->sanitizeSwitcherInstances(
            $input['switcher_instances'] ?? [],
            $sanitized
        );

        if ($sameRuntimeIdentity && $sanitized['switcher_contract_revision'] !== null) {
            $sanitized['switcher_local_conflict'] = $sanitized['switcher_local_conflict']
                || $this->switcherConfigHash($this->exportSwitcherContract($sanitized))
                    !== $this->switcherConfigHash((array) $sanitized['switcher_contract_config']);
        }

        return $sanitized;
    }

    /**
     * Sanitize the deliberately small selector grammar produced by the visual
     * editor: element, #id and .class compounds joined by descendant or direct-
     * child combinators. Attribute selectors, selector lists, pseudo selectors
     * and CSS escape syntax are rejected rather than interpreted.
     */
    public function sanitizeSwitcherSelector($value): string
    {
        $selector = trim((string) $value);
        if ($selector === '' || strlen($selector) > self::SWITCHER_SELECTOR_MAX_LEN) {
            return '';
        }

        $selector = preg_replace('/\s+/', ' ', $selector);
        $selector = preg_replace('/\s*>\s*/', ' > ', (string) $selector);
        $compound = '(?:[A-Za-z][A-Za-z0-9-]*|[.#][A-Za-z_][A-Za-z0-9_-]*)(?:[.#][A-Za-z_][A-Za-z0-9_-]*)*';

        if (!preg_match('/^' . $compound . '(?:(?:\s*>\s*|\s+)' . $compound . ')*$/D', (string) $selector)) {
            return '';
        }

        preg_match_all('/(?:^|[\s>])([A-Za-z][A-Za-z0-9-]*)/', (string) $selector, $tagMatches);
        $unsafeTags = ['script', 'style', 'head', 'meta', 'link', 'base', 'iframe', 'object', 'embed'];
        foreach ($tagMatches[1] ?? [] as $tagName) {
            if (in_array(strtolower((string) $tagName), $unsafeTags, true)) {
                return '';
            }
        }

        return (string) $selector;
    }

    /**
     * @return array<int,array<string,mixed>>
     */
    public function getSwitcherInstances(): array
    {
        $settings = $this->all();
        $raw = $settings['switcher_instances'] ?? [];
        if (!is_array($raw) || $raw === []) {
            return [$this->legacySwitcherInstance($settings)];
        }

        $instances = [];
        $seen = [];
        foreach (array_slice($raw, 0, self::SWITCHER_INSTANCES_MAX) as $candidate) {
            if (!is_array($candidate)) {
                continue;
            }
            $instance = $this->sanitizeSwitcherInstance($candidate, $settings);
            $id = $instance['id'];
            if ($id === '' || isset($seen[$id])) {
                continue;
            }
            $seen[$id] = true;
            $instances[] = $instance;
        }

        return $instances !== [] ? $instances : [$this->legacySwitcherInstance($settings)];
    }

    /**
     * Resolve a saved instance. Unknown IDs safely fall back to the default so
     * old shortcodes, blocks and widgets never disappear after an admin rename.
     *
     * @return array<string,mixed>
     */
    public function getSwitcherInstance(?string $id = null): array
    {
        $requested = $this->sanitizeSwitcherInstanceId($id ?? 'default');
        $instances = $this->getSwitcherInstances();
        $fallback = $instances[0];

        foreach ($instances as $instance) {
            if (($instance['id'] ?? '') === 'default') {
                $fallback = $instance;
            }
            if (($instance['id'] ?? '') === $requested) {
                return $instance;
            }
        }

        return $fallback;
    }

    /**
     * @return array<int,array<string,mixed>>
     */
    public function getAutoInjectSwitcherInstances(): array
    {
        return array_values(array_filter(
            $this->getSwitcherInstances(),
            static fn (array $instance): bool => !empty($instance['enabled']) && !empty($instance['auto_inject'])
        ));
    }

    public function sanitizeSwitcherInstanceId($value): string
    {
        if (function_exists('sanitize_key')) {
            return substr(sanitize_key((string) $value), 0, 64);
        }

        return substr(strtolower((string) preg_replace('/[^a-z0-9_-]/i', '', (string) $value)), 0, 64);
    }

    /**
     * @param mixed $raw
     * @param array<string,mixed> $settings
     * @return array<int,array<string,mixed>>
     */
    private function sanitizeSwitcherInstances($raw, array $settings): array
    {
        $instances = [$this->legacySwitcherInstance($settings)];
        $seen = ['default' => true];

        if (!is_array($raw)) {
            return $instances;
        }

        foreach (array_slice($raw, 0, self::SWITCHER_INSTANCES_MAX) as $candidate) {
            if (!is_array($candidate)) {
                continue;
            }
            $instance = $this->sanitizeSwitcherInstance($candidate, $settings);
            $id = $instance['id'];
            if ($id === '' || isset($seen[$id])) {
                continue;
            }
            $seen[$id] = true;
            $instances[] = $instance;
        }

        return $instances;
    }

    /**
     * @param array<string,mixed> $raw
     * @param array<string,mixed> $settings
     * @return array<string,mixed>
     */
    private function sanitizeSwitcherInstance(array $raw, array $settings): array
    {
        $sourceLanguage = $this->sanitizeLanguage((string) ($settings['source_language'] ?? 'de'));
        $targetLanguages = $this->normalizeLanguageList($settings['target_languages'] ?? []);

        return [
            'id' => $this->sanitizeSwitcherInstanceId($raw['id'] ?? ''),
            'name' => sanitize_text_field((string) ($raw['name'] ?? 'Switcher')),
            'template' => $this->sanitizeSwitcherInstanceId($raw['template'] ?? 'custom'),
            'template_version' => max(1, (int) ($raw['template_version'] ?? self::SWITCHER_INSTANCES_VERSION)),
            'enabled' => !empty($raw['enabled']),
            'auto_inject' => !empty($raw['auto_inject']),
            'style' => $this->sanitizeEnum((string) ($raw['style'] ?? 'list'), self::SWITCHER_STYLES, 'list'),
            'flag_style' => $this->sanitizeEnum((string) ($raw['flag_style'] ?? 'rectangle_mat'), self::SWITCHER_FLAG_STYLES, 'rectangle_mat'),
            'show_label' => !empty($raw['show_label']),
            'label_format' => $this->sanitizeEnum((string) ($raw['label_format'] ?? 'full_name'), self::SWITCHER_LABEL_FORMATS, 'full_name'),
            'language_order' => $this->normalizeLanguageList($raw['language_order'] ?? []),
            'custom_css' => trim((string) ($raw['custom_css'] ?? '')),
            'position' => $this->sanitizeEnum((string) ($raw['position'] ?? 'inline'), self::SWITCHER_POSITIONS, 'inline'),
            'responsive_hide' => $this->sanitizeEnum((string) ($raw['responsive_hide'] ?? 'none'), self::SWITCHER_RESPONSIVE_HIDE_VALUES, 'none'),
            'responsive_breakpoint' => $this->sanitizeBreakpoint($raw['responsive_breakpoint'] ?? self::SWITCHER_BREAKPOINT_DEFAULT),
            'custom_flags' => $this->sanitizeCustomFlags($raw['custom_flags'] ?? [], $sourceLanguage, $targetLanguages),
            'custom_names' => $this->sanitizeCustomNames($raw['custom_names'] ?? [], $sourceLanguage, $targetLanguages),
            'selector' => $this->sanitizeSwitcherSelector($raw['selector'] ?? ''),
        ];
    }

    /**
     * @param array<string,mixed> $settings
     * @return array<string,mixed>
     */
    private function legacySwitcherInstance(array $settings): array
    {
        return [
            'id' => 'default',
            'name' => (string) ($settings['switcher_name'] ?? 'Standard'),
            'template' => 'legacy',
            'template_version' => self::SWITCHER_INSTANCES_VERSION,
            'enabled' => !empty($settings['switcher_enabled']),
            'auto_inject' => !empty($settings['switcher_auto_inject']),
            'style' => $this->sanitizeEnum((string) ($settings['switcher_default_style'] ?? 'list'), self::SWITCHER_STYLES, 'list'),
            'flag_style' => $this->sanitizeEnum((string) ($settings['switcher_flag_style'] ?? 'rectangle_mat'), self::SWITCHER_FLAG_STYLES, 'rectangle_mat'),
            'show_label' => !empty($settings['switcher_show_label']),
            'label_format' => $this->sanitizeEnum((string) ($settings['switcher_label_format'] ?? 'full_name'), self::SWITCHER_LABEL_FORMATS, 'full_name'),
            'language_order' => $this->normalizeLanguageList($settings['switcher_language_order'] ?? []),
            'custom_css' => trim((string) ($settings['switcher_custom_css'] ?? '')),
            'position' => $this->sanitizeEnum((string) ($settings['switcher_position'] ?? 'inline'), self::SWITCHER_POSITIONS, 'inline'),
            'responsive_hide' => $this->sanitizeEnum((string) ($settings['switcher_responsive_hide'] ?? 'none'), self::SWITCHER_RESPONSIVE_HIDE_VALUES, 'none'),
            'responsive_breakpoint' => $this->sanitizeBreakpoint($settings['switcher_responsive_breakpoint'] ?? self::SWITCHER_BREAKPOINT_DEFAULT),
            'custom_flags' => is_array($settings['switcher_custom_flags'] ?? null) ? $settings['switcher_custom_flags'] : [],
            'custom_names' => is_array($settings['switcher_custom_names'] ?? null) ? $settings['switcher_custom_names'] : [],
            'selector' => $this->sanitizeSwitcherSelector($settings['switcher_selector'] ?? ''),
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

    private function sanitizeCustomNames($value, string $sourceLang, array $targetLangs): array
    {
        if (!is_array($value)) return [];
        $configured = array_flip(array_merge([$sourceLang], $targetLangs));
        $clean = [];
        foreach ($value as $lang => $name) {
            $lang = $this->sanitizeLanguage((string) $lang);
            if ($lang === '' || !isset($configured[$lang]) || !is_string($name)) continue;
            $name = trim(sanitize_text_field($name));
            if ($name !== '') $clean[$lang] = mb_substr($name, 0, 80);
        }
        return $clean;
    }

    /** Stable v1 payload shared by wp-admin, settings-sync and runtime-config. */
    public function exportSwitcherContract(?array $settings = null): array
    {
        $settings = $settings ?? $this->all();
        $instances = [$this->legacySwitcherInstance($settings)];
        foreach ((array) ($settings['switcher_instances'] ?? []) as $candidate) {
            if (is_array($candidate) && ($candidate['id'] ?? '') !== 'default') $instances[] = $candidate;
        }
        $result = [];
        foreach ($instances as $instance) {
            $result[] = [
                'id' => (string) $instance['id'],
                'name' => (string) $instance['name'],
                'enabled' => !empty($instance['enabled']),
                'autoInject' => !empty($instance['auto_inject']),
                'style' => (string) $instance['style'],
                'flagStyle' => (string) $instance['flag_style'],
                'showLabel' => !empty($instance['show_label']),
                'labelFormat' => (string) $instance['label_format'],
                'languageOrder' => array_values((array) $instance['language_order']),
                // The renderer strips '<' before emitting CSS. Report that
                // effective value so legacy CSS remains mirrorable in v1.
                'customCss' => str_replace('<', '', trim((string) $instance['custom_css'])),
                'position' => (string) $instance['position'],
                'responsiveHide' => (string) $instance['responsive_hide'],
                'responsiveBreakpoint' => (int) $instance['responsive_breakpoint'],
                'customFlags' => (object) ($instance['custom_flags'] ?? []),
                'customNames' => (object) ($instance['custom_names'] ?? []),
                'selector' => (string) $instance['selector'],
            ];
        }
        return ['contractVersion' => 1, 'instances' => $result];
    }

    /** Canonical SHA-256; instance and language list order remains meaningful. */
    public function switcherConfigHash(array $config): string
    {
        foreach ((array) ($config['instances'] ?? []) as $index => $instance) {
            foreach (['customFlags', 'customNames'] as $field) {
                $config['instances'][$index][$field] = (object) ($instance[$field] ?? []);
            }
        }
        return hash('sha256', json_encode($this->canonicalSwitcherValue($config), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_LINE_TERMINATORS));
    }

    private function canonicalSwitcherValue($value)
    {
        if (is_object($value)) {
            $value = get_object_vars($value);
            ksort($value, SORT_STRING);
            return (object) array_map([$this, 'canonicalSwitcherValue'], $value);
        }
        if (is_array($value)) {
            if ($value === [] || array_keys($value) === range(0, count($value) - 1)) {
                return array_map([$this, 'canonicalSwitcherValue'], $value);
            }
            ksort($value, SORT_STRING);
            return (object) array_map([$this, 'canonicalSwitcherValue'], $value);
        }
        return $value;
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

    public function getVisibleTargetLanguages(): array
    {
        $options = $this->all();
        return array_values(array_intersect(
            $options['target_languages'],
            is_array($options['visible_target_languages'] ?? null) ? $options['visible_target_languages'] : $options['target_languages']
        ));
    }

    public function shouldAutomaticallyTranslateTarget(string $language): bool
    {
        $options = $this->all();
        return $this->shouldAutomaticallyTranslate()
            && in_array(strtolower($language), is_array($options['automatic_target_languages'] ?? null) ? $options['automatic_target_languages'] : $options['target_languages'], true);
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

    /** A previously synchronized project may temporarily have no active targets. */
    public function hasRuntimeIdentity(): bool
    {
        $options = $this->all();
        return !empty($options['api_key'])
            && !empty($options['api_base_url'])
            && $this->normalizeSaasProjectVersion($options['saas_project_version'] ?? '') !== '';
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

    /**
     * @return array<string, array<string, string>>
     */
    public function getUrlSlugMappings(): array
    {
        $options = $this->all();
        $urlSlugMappings = get_option(self::URL_SLUG_MAPPINGS_OPTION_KEY, null);

        return $this->normalizeUrlSlugMappings(
            is_array($urlSlugMappings) ? $urlSlugMappings : ($options['url_slug_mappings'] ?? []),
            $this->normalizeLanguageList($options['target_languages'] ?? [])
        );
    }

    public function clearUrlSlugMappings(): bool
    {
        return $this->storeUrlSlugMappings([]);
    }

    /**
     * Return only the authenticated project's safe, active-language media URLs.
     *
     * @return array<string, string>
     */
    public function getMediaReplacements(string $targetLanguage): array
    {
        $settings = $this->all();
        $language = $this->sanitizeLanguage($targetLanguage);
        $activeLanguages = $this->normalizeLanguageList($settings['target_languages'] ?? []);

        if ($language === '' || !in_array($language, $activeLanguages, true)) {
            return [];
        }

        $persisted = get_option(self::MEDIA_REPLACEMENTS_OPTION_KEY, []);
        $mappings = $this->normalizeMediaReplacements($persisted, $activeLanguages);

        return $mappings[$language] ?? [];
    }

    public function clearMediaReplacements(): bool
    {
        return $this->storeMediaReplacements([]);
    }

    public function shouldAutoRedirect(): bool
    {
        $options = $this->all();

        return (bool) $options['auto_redirect'];
    }

    /** Dashboard-controlled disclosure on translated pages; defaults off. */
    public function shouldDisplayAiNotice(): bool
    {
        $options = $this->all();

        return ($options['display_ai_notice'] ?? false) === true;
    }

    /** Whether uncached content may be translated automatically. */
    public function shouldAutomaticallyTranslate(): bool
    {
        $options = $this->all();

        return ($options['automatic_translation'] ?? true) === true;
    }

    /** Monotonic version of the last authenticated SaaS project readback. */
    public function getSaasProjectVersion(): string
    {
        $options = $this->all();

        return $this->normalizeSaasProjectVersion($options['saas_project_version'] ?? '');
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

    /** Dashboard opt-in for anonymous translated-page views; defaults off. */
    public function shouldTrackPageViews(): bool
    {
        $options = $this->all();

        return ($options['page_views_enabled'] ?? false) === true;
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

    public function applyRuntimeConfig(
        array $runtimeConfig,
        ?string $fetchedWithApiKey = null,
        ?string $fetchedFromBaseUrl = null
    ): bool {
        // Evict this request's options cache and re-read before merging: the
        // sync rewrites the WHOLE option, and on a busy site a request that
        // started before an admin save would otherwise write its stale
        // snapshot back and silently revert the admin's change (observed
        // live: enable_dynamic_translation flipped off minutes after being
        // saved). v1 switcher updates also compare the persisted option at
        // write time so a concurrent admin save cannot be replaced.
        if (function_exists('wp_cache_delete')) {
            wp_cache_delete(self::OPTION_KEY, 'options');
            wp_cache_delete('alloptions', 'options');
        }

        $settings = $this->all();
        $storedBeforeMerge = get_option(self::OPTION_KEY, []);
        $switcherV1 = is_array($runtimeConfig['switcher'] ?? null)
            && ($runtimeConfig['switcher']['contractVersion'] ?? null) === 1;

        // The payload was fetched BEFORE the fresh re-read above. If it was
        // fetched with a different API key (admin switched projects) or from a
        // different backend (admin changed the base URL, or test-connection
        // probed a candidate backend that was never saved), it belongs to
        // another project/backend — discard it instead of merging foreign
        // exclusions/switcher data into these settings. The sync timestamp
        // stays untouched, so the next refresh retries with the current
        // configuration.
        if (
            $fetchedWithApiKey !== null
            && $fetchedWithApiKey !== (string) ($settings['api_key'] ?? '')
        ) {
            return false;
        }
        if (
            $fetchedFromBaseUrl !== null
            && untrailingslashit($fetchedFromBaseUrl) !== untrailingslashit((string) ($settings['api_base_url'] ?? ''))
        ) {
            return false;
        }

        if (array_key_exists('pageViewsEnabled', $runtimeConfig)) {
            // Only the JSON boolean true is consent; malformed or loosely
            // truthy backend values must never accidentally activate tracking.
            $settings['page_views_enabled'] = $runtimeConfig['pageViewsEnabled'] === true;
        }

        if (array_key_exists('project', $runtimeConfig)) {
            $this->applyRuntimeProjectSettings($settings, $runtimeConfig['project']);
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

        if (!$switcherV1 && array_key_exists('urlSlugs', $runtimeConfig) && is_array($runtimeConfig['urlSlugs'])) {
            $this->storeUrlSlugMappings($this->normalizeRuntimeUrlSlugs(
                $runtimeConfig['urlSlugs'],
                $this->normalizeLanguageList($settings['target_languages'] ?? [])
            ));
        }

        if (!$switcherV1 && array_key_exists('mediaReplacements', $runtimeConfig)) {
            $this->storeMediaReplacements($this->normalizeMediaReplacements(
                $runtimeConfig['mediaReplacements'],
                $this->normalizeLanguageList($settings['target_languages'] ?? [])
            ));
        }

        if (array_key_exists('switcher', $runtimeConfig) && is_array($runtimeConfig['switcher'])) {
            $switcher = $runtimeConfig['switcher'];
            if (($switcher['contractVersion'] ?? null) === 1 && ($switcher['owner'] ?? null) === 'saas') {
                $revision = $switcher['revision'] ?? null;
                if (is_int($revision) && $revision > (int) ($settings['switcher_contract_last_seen'] ?? 0)) {
                    $settings['switcher_contract_owner'] = 'saas';
                    $settings['switcher_contract_last_seen'] = $revision;
                    $this->applySwitcherContract($settings, $switcher);
                }
            } elseif (($switcher['contractVersion'] ?? null) === 1 && ($switcher['owner'] ?? null) === 'wordpress') {
                $revision = $switcher['revision'] ?? null;
                if (is_int($revision) && $revision > (int) ($settings['switcher_contract_last_seen'] ?? 0)) {
                    $settings['switcher_contract_owner'] = 'wordpress';
                    $settings['switcher_contract_last_seen'] = $revision;
                    $settings['switcher_contract_revision'] = null;
                    $settings['switcher_contract_config'] = [];
                    $settings['switcher_local_conflict'] = false;
                }
            }

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

            $customInstances = array_values(array_filter(
                is_array($settings['switcher_instances'] ?? null) ? $settings['switcher_instances'] : [],
                static fn ($instance): bool => is_array($instance) && ($instance['id'] ?? '') !== 'default'
            ));
            $settings['switcher_instances_version'] = self::SWITCHER_INSTANCES_VERSION;
            $settings['switcher_instances'] = array_merge(
                [$this->legacySwitcherInstance($settings)],
                $customInstances
            );
        }

        $settings['runtime_config_synced_at'] = time();
        unset($settings['url_slug_mappings'], $settings['media_replacements']);

        if (!$switcherV1) return $this->updateSettingsOption($settings, true);

        // Keep the settings CAS and dedicated map writes in one database
        // transaction. A concurrent wp-admin project/backend change either
        // wins before the CAS (all old payload writes are rejected) or waits
        // for these writes to commit. The options row is the serialization
        // point; WordPress stores all three options in the same table.
        global $wpdb;
        if (!isset($wpdb) || $wpdb->query('START TRANSACTION') === false) return false;
        if (!$this->compareAndUpdateSwitcherOption($storedBeforeMerge, $settings)) {
            $wpdb->query('ROLLBACK');
            $this->clearRuntimeOptionsCache();
            return false;
        }
        $wpdb->last_error = '';
        if (array_key_exists('urlSlugs', $runtimeConfig) && is_array($runtimeConfig['urlSlugs'])) {
            $this->storeUrlSlugMappings($this->normalizeRuntimeUrlSlugs(
                $runtimeConfig['urlSlugs'], $this->normalizeLanguageList($settings['target_languages'] ?? [])
            ));
        }
        if ($wpdb->last_error !== '') {
            $wpdb->query('ROLLBACK');
            $this->clearRuntimeOptionsCache();
            return false;
        }
        $wpdb->last_error = '';
        if (array_key_exists('mediaReplacements', $runtimeConfig)) {
            $this->storeMediaReplacements($this->normalizeMediaReplacements(
                $runtimeConfig['mediaReplacements'], $this->normalizeLanguageList($settings['target_languages'] ?? [])
            ));
        }
        if ($wpdb->last_error !== '') {
            $wpdb->query('ROLLBACK');
            $this->clearRuntimeOptionsCache();
            return false;
        }
        if ($wpdb->query('COMMIT') === false) {
            $wpdb->query('ROLLBACK');
            $this->clearRuntimeOptionsCache();
            return false;
        }
        $this->clearRuntimeOptionsCache();
        return true;
    }

    private function clearRuntimeOptionsCache(): void
    {
        if (!function_exists('wp_cache_delete')) return;
        foreach ([self::OPTION_KEY, self::URL_SLUG_MAPPINGS_OPTION_KEY, self::MEDIA_REPLACEMENTS_OPTION_KEY] as $key) {
            wp_cache_delete($key, 'options');
        }
        wp_cache_delete('alloptions', 'options');
        wp_cache_delete('notoptions', 'options');
    }

    /** Atomically reject a v1 payload if wp-admin or another sync wrote first. */
    private function compareAndUpdateSwitcherOption($expected, array $settings): bool
    {
        global $wpdb;
        if (!isset($wpdb) || !isset($wpdb->options) || !function_exists('maybe_serialize')) return false;
        $query = $wpdb->prepare(
            "UPDATE {$wpdb->options} SET option_value = %s WHERE option_name = %s AND BINARY option_value = BINARY %s",
            maybe_serialize($settings), self::OPTION_KEY, maybe_serialize($expected)
        );
        $updated = $wpdb->query($query);
        if ($updated !== 1) return false;
        if (function_exists('wp_cache_delete')) {
            wp_cache_delete(self::OPTION_KEY, 'options');
            wp_cache_delete('alloptions', 'options');
            wp_cache_delete('notoptions', 'options');
        }
        return true;
    }

    /** Apply only an acknowledged successor to the same local switcher state. */
    private function applySwitcherContract(array &$settings, array $switcher): void
    {
        $revision = $switcher['revision'] ?? null;
        $config = $switcher['config'] ?? null;
        if (!is_int($revision) || $revision < 1 || !is_array($config)
            || ($config['contractVersion'] ?? null) !== 1 || !is_array($config['instances'] ?? null)) return;
        $applied = $settings['switcher_contract_revision'] ?? null;
        if ($applied === $revision) return;
        if ($applied !== null && $revision < $applied) return;
        $local = $this->exportSwitcherContract($settings);
        $expected = $applied === ($switcher['baseRevision'] ?? null)
            ? ($switcher['baseConfig'] ?? null)
            : ($settings['switcher_contract_config'] ?? null);
        if (!is_array($expected) || !empty($settings['switcher_local_conflict'])
            || $this->switcherConfigHash($local) !== $this->switcherConfigHash($expected)) {
            $settings['switcher_local_conflict'] = true;
            return;
        }
        $previousSettings = $settings;
        $currentById = [];
        foreach ((array) ($settings['switcher_instances'] ?? []) as $instance) {
            if (is_array($instance) && isset($instance['id'])) $currentById[$instance['id']] = $instance;
        }
        $newInstances = [];
        foreach (array_slice($config['instances'], 0, self::SWITCHER_INSTANCES_MAX) as $incoming) {
            if (!is_array($incoming) || !isset($incoming['id'])) return;
            $id = $this->sanitizeSwitcherInstanceId($incoming['id']);
            $raw = array_merge($currentById[$id] ?? [], [
                'id' => $id,
                'name' => $incoming['name'] ?? 'Switcher',
                'enabled' => $incoming['enabled'] ?? false,
                'auto_inject' => $incoming['autoInject'] ?? false,
                'style' => $incoming['style'] ?? 'list',
                'flag_style' => $incoming['flagStyle'] ?? 'rectangle_mat',
                'show_label' => $incoming['showLabel'] ?? true,
                'label_format' => $incoming['labelFormat'] ?? 'full_name',
                'language_order' => $incoming['languageOrder'] ?? [],
                'custom_css' => $incoming['customCss'] ?? '',
                'position' => $incoming['position'] ?? 'inline',
                'responsive_hide' => $incoming['responsiveHide'] ?? 'none',
                'responsive_breakpoint' => $incoming['responsiveBreakpoint'] ?? self::SWITCHER_BREAKPOINT_DEFAULT,
                'custom_flags' => $incoming['customFlags'] ?? [],
                'custom_names' => $incoming['customNames'] ?? [],
                'selector' => $incoming['selector'] ?? '',
            ]);
            if ($id === 'default') {
                $settings['switcher_name'] = $raw['name'];
                $settings['switcher_enabled'] = !empty($raw['enabled']);
                $settings['switcher_selector'] = $raw['selector'];
                $settings['switcher_auto_inject'] = !empty($raw['auto_inject']);
                $settings['switcher_default_style'] = $raw['style'];
                $settings['switcher_flag_style'] = $raw['flag_style'];
                $settings['switcher_show_label'] = !empty($raw['show_label']);
                $settings['switcher_label_format'] = $raw['label_format'];
                $settings['switcher_language_order'] = $raw['language_order'];
                $settings['switcher_custom_css'] = $raw['custom_css'];
                $settings['switcher_position'] = $raw['position'];
                $settings['switcher_responsive_hide'] = $raw['responsive_hide'];
                $settings['switcher_responsive_breakpoint'] = $raw['responsive_breakpoint'];
                $settings['switcher_custom_flags'] = $raw['custom_flags'];
                $settings['switcher_custom_names'] = $raw['custom_names'];
            } else {
                $newInstances[] = $this->sanitizeSwitcherInstance($raw, $settings);
            }
        }
        $settings['switcher_instances'] = array_merge([$this->legacySwitcherInstance($settings)], $newInstances);
        if ($this->switcherConfigHash($this->exportSwitcherContract($settings)) !== $this->switcherConfigHash($config)) {
            $settings = $previousSettings;
            $settings['switcher_local_conflict'] = true;
            return;
        }
        $settings['switcher_contract_revision'] = $revision;
        $settings['switcher_contract_config'] = $config;
        $settings['switcher_local_conflict'] = false;
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
        $language = strtolower(str_replace('_', '-', trim($language)));

        return preg_match('/^[a-z]{2,3}(?:-[a-z]{4})?(?:-(?:[a-z]{2}|[0-9]{3}))?$/D', $language) === 1
            ? $language
            : '';
    }

    /**
     * Applies one complete, versioned project snapshot from runtime-config.
     * Malformed, internally inconsistent or older snapshots are ignored as a
     * unit so a partial response can never mix two SaaS project revisions.
     *
     * @param array<string,mixed> $settings
     * @param mixed               $runtimeProject
     */
    private function applyRuntimeProjectSettings(array &$settings, $runtimeProject): void
    {
        if (!is_array($runtimeProject)) {
            return;
        }

        foreach (
            [
                'version',
                'sourceLanguage',
                'targetLanguages',
                'autoRedirect',
                'displayAiNotice',
                'automaticTranslation',
            ] as $requiredField
        ) {
            if (!array_key_exists($requiredField, $runtimeProject)) {
                return;
            }
        }

        $version = $this->normalizeSaasProjectVersion($runtimeProject['version']);
        $storedVersion = $this->normalizeSaasProjectVersion($settings['saas_project_version'] ?? '');
        if ($version === '' || ($storedVersion !== '' && strcmp($version, $storedVersion) < 0)) {
            return;
        }

        $sourceLanguage = $this->normalizeRuntimeLanguage($runtimeProject['sourceLanguage']);
        $targetLanguages = $this->normalizeRuntimeLanguages($runtimeProject['targetLanguages']);
        if (
            $sourceLanguage === ''
            || $targetLanguages === null
            || in_array($sourceLanguage, $targetLanguages, true)
            || !is_bool($runtimeProject['autoRedirect'])
            || !is_bool($runtimeProject['displayAiNotice'])
            || !is_bool($runtimeProject['automaticTranslation'])
        ) {
            return;
        }

        $visibleTargetLanguages = $this->normalizeRuntimeLanguages($runtimeProject['visibleTargetLanguages'] ?? $targetLanguages);
        $automaticTargetLanguages = $this->normalizeRuntimeLanguages($runtimeProject['automaticTargetLanguages'] ?? $targetLanguages);
        if ($visibleTargetLanguages === null || $automaticTargetLanguages === null
            || array_diff($visibleTargetLanguages, $targetLanguages) !== []
            || array_diff($automaticTargetLanguages, $targetLanguages) !== []) {
            return;
        }
        $generations = null;
        if (array_key_exists('targetLanguageGenerations', $runtimeProject)) {
            $generations = $runtimeProject['targetLanguageGenerations'];
            if (!is_array($generations)
                || array_diff(array_keys($generations), $targetLanguages) !== []
                || array_diff($targetLanguages, array_keys($generations)) !== []) {
                return;
            }
            foreach ($generations as $code => $generation) {
                if (!is_string($generation) || preg_match('/^[A-Za-z0-9_-]{1,128}$/D', $generation) !== 1) return;
            }
        }
        $settings['source_language'] = $sourceLanguage;
        $settings['target_languages'] = $targetLanguages;
        $settings['visible_target_languages'] = $visibleTargetLanguages;
        $settings['automatic_target_languages'] = $automaticTargetLanguages;
        if ($generations !== null) {
            $settings['target_language_generations'] = $generations;
        }
        $settings['auto_redirect'] = $runtimeProject['autoRedirect'];
        $settings['display_ai_notice'] = $runtimeProject['displayAiNotice'];
        $settings['automatic_translation'] = $runtimeProject['automaticTranslation'];
        $settings['saas_project_version'] = $version;
    }

    /** @param mixed $value */
    private function normalizeRuntimeLanguage($value): string
    {
        if (!is_string($value)) {
            return '';
        }

        $language = strtolower(str_replace('_', '-', trim($value)));

        return preg_match('/^[a-z]{2,3}(?:-[a-z]{4})?(?:-(?:[a-z]{2}|[0-9]{3}))?$/D', $language) === 1
            ? $language
            : '';
    }

    /**
     * @param mixed $value
     * @return string[]|null
     */
    private function normalizeRuntimeLanguages($value): ?array
    {
        if (!is_array($value) || count($value) > 200) {
            return null;
        }

        $languages = [];
        foreach ($value as $language) {
            $normalized = $this->normalizeRuntimeLanguage($language);
            if ($normalized === '') {
                return null;
            }
            $languages[] = $normalized;
        }

        return array_values(array_unique($languages));
    }

    /** @param mixed $value */
    private function normalizeSaasProjectVersion($value): string
    {
        if (!is_string($value)) {
            return '';
        }

        $version = trim($value);
        if (
            preg_match(
                '/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/D',
                $version,
                $parts
            ) !== 1
            || !checkdate((int) $parts[2], (int) $parts[3], (int) $parts[1])
            || (int) $parts[4] > 23
            || (int) $parts[5] > 59
            || (int) $parts[6] > 59
        ) {
            return '';
        }

        return $version;
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

    /**
     * @param array<string, mixed> $settings
     */
    private function updateSettingsOption(array $settings, bool $suppressSync = false): bool
    {
        if (!function_exists('update_option')) {
            return false;
        }

        if ($suppressSync) {
            $GLOBALS['deepglot_applying_runtime_config'] = true;
        }

        $updated = update_option(self::OPTION_KEY, $settings);

        if ($suppressSync) {
            unset($GLOBALS['deepglot_applying_runtime_config']);
        }

        return (bool) $updated;
    }

    /**
     * @param array<string, array<string, string>> $mappings
     */
    private function storeUrlSlugMappings(array $mappings): bool
    {
        $mappings = $this->boundUrlSlugMappingsByBytes($mappings);

        if (function_exists('add_option')) {
            $added = add_option(self::URL_SLUG_MAPPINGS_OPTION_KEY, $mappings, '', false);

            if ($added) {
                if (function_exists('wp_cache_delete')) {
                    wp_cache_delete(self::URL_SLUG_MAPPINGS_OPTION_KEY, 'options');
                    wp_cache_delete('alloptions', 'options');
                }

                return true;
            }
        }

        if (!function_exists('update_option')) {
            return false;
        }

        $updated = update_option(self::URL_SLUG_MAPPINGS_OPTION_KEY, $mappings);

        if (function_exists('wp_cache_delete')) {
            wp_cache_delete(self::URL_SLUG_MAPPINGS_OPTION_KEY, 'options');
            wp_cache_delete('alloptions', 'options');
        }

        return (bool) $updated;
    }

    /**
     * Image mappings remain outside WordPress's autoloaded global options.
     *
     * @param array<string, array<string, string>> $mappings
     */
    private function storeMediaReplacements(array $mappings): bool
    {
        if (strlen(serialize($mappings)) > self::MEDIA_REPLACEMENTS_MAX_BYTES) {
            $mappings = [];
        }

        if (function_exists('add_option')) {
            $added = add_option(self::MEDIA_REPLACEMENTS_OPTION_KEY, $mappings, '', false);

            if ($added) {
                if (function_exists('wp_cache_delete')) {
                    wp_cache_delete(self::MEDIA_REPLACEMENTS_OPTION_KEY, 'options');
                    wp_cache_delete('alloptions', 'options');
                }

                return true;
            }
        }

        if (!function_exists('update_option')) {
            return false;
        }

        $updated = update_option(self::MEDIA_REPLACEMENTS_OPTION_KEY, $mappings);

        if (function_exists('wp_cache_delete')) {
            wp_cache_delete(self::MEDIA_REPLACEMENTS_OPTION_KEY, 'options');
            wp_cache_delete('alloptions', 'options');
        }

        return (bool) $updated;
    }

    /**
     * @param mixed $value
     * @param string[] $allowedLanguages
     * @return array<string, array<string, string>>
     */
    private function normalizeMediaReplacements($value, array $allowedLanguages): array
    {
        if (!is_array($value) || strlen(serialize($value)) > self::MEDIA_REPLACEMENTS_MAX_BYTES) {
            return [];
        }

        $mappings = [];
        $blocked = [];
        $seenCount = 0;

        foreach ($value as $rawLanguage => $languageMappings) {
            if (!is_string($rawLanguage) || !is_array($languageMappings)) {
                continue;
            }

            $language = $this->sanitizeLanguage($rawLanguage);
            if ($language === '' || !in_array($language, $allowedLanguages, true)) {
                continue;
            }

            foreach ($languageMappings as $rawOriginal => $rawLocalized) {
                $seenCount++;
                if ($seenCount > self::MEDIA_REPLACEMENTS_MAX) {
                    return [];
                }

                if (!is_string($rawOriginal) || !is_string($rawLocalized)) {
                    continue;
                }

                $original = $this->normalizeMediaReplacementUrl($rawOriginal);
                $localized = $this->normalizeMediaReplacementUrl($rawLocalized);

                if (
                    $original === null || $localized === null
                    || $this->mediaReplacementKind($original) !== $this->mediaReplacementKind($localized)
                    || ($this->mediaReplacementKind($original) === 'embed'
                        && wp_parse_url($original, PHP_URL_HOST) !== wp_parse_url($localized, PHP_URL_HOST))
                    || (in_array($this->mediaReplacementKind($original), ['document', 'video'], true)
                        && strtolower((string) pathinfo((string) wp_parse_url($original, PHP_URL_PATH), PATHINFO_EXTENSION))
                            !== strtolower((string) pathinfo((string) wp_parse_url($localized, PHP_URL_PATH), PATHINFO_EXTENSION)))
                    || isset($blocked[$language][$original])
                ) {
                    continue;
                }

                if (isset($mappings[$language][$original]) && $mappings[$language][$original] !== $localized) {
                    unset($mappings[$language][$original]);
                    $blocked[$language][$original] = true;
                    continue;
                }

                $mappings[$language][$original] = $localized;
            }

            if (isset($mappings[$language]) && $mappings[$language] === []) {
                unset($mappings[$language]);
            }
        }

        return strlen(serialize($mappings)) <= self::MEDIA_REPLACEMENTS_MAX_BYTES
            ? $mappings
            : [];
    }

    private function normalizeMediaReplacementUrl(string $value): ?string
    {
        if (
            $value === ''
            || strlen($value) > self::MEDIA_REPLACEMENT_URL_MAX_LEN
            || preg_match('/[\x00-\x20\x7f\\\\]/', $value) === 1
            || preg_match('/%(?![0-9a-f]{2})/i', $value) === 1
            || preg_match('/%(?:0[0-9a-f]|1[0-9a-f]|2f|5c|7f)/i', $value) === 1
            || str_starts_with($value, '//')
        ) {
            return null;
        }

        if ($this->mediaReplacementKind($value) === 'embed') {
            return $value;
        }

        $parts = wp_parse_url($value);
        if (
            !is_array($parts)
            || isset($parts['fragment'])
            || isset($parts['user'])
            || isset($parts['pass'])
        ) {
            return null;
        }

        if (isset($parts['scheme']) || isset($parts['host'])) {
            if (strtolower((string) ($parts['scheme'] ?? '')) !== 'https') {
                return null;
            }

            $siteUrl = function_exists('get_site_url') ? (string) get_site_url() : '';
            $siteParts = $siteUrl !== '' ? wp_parse_url($siteUrl) : false;

            if (
                !is_array($siteParts)
                || !isset($siteParts['host'], $parts['host'])
                || strtolower((string) $siteParts['host']) !== strtolower((string) $parts['host'])
                || (int) ($siteParts['port'] ?? 443) !== (int) ($parts['port'] ?? 443)
            ) {
                return null;
            }
        } elseif (!str_starts_with($value, '/')) {
            return null;
        }

        $path = (string) ($parts['path'] ?? '');
        $decodedPath = rawurldecode($path);

        if (
            $path === ''
            || !str_starts_with($path, '/')
            || str_starts_with($path, '//')
            || str_contains($decodedPath, '\\')
            || preg_match('#(?:^|/)\.\.?(/|$)#', $decodedPath) === 1
            || preg_match('/%(?:2e|2f|5c)/i', $decodedPath) === 1
            || $this->mediaReplacementKind($path) === null
        ) {
            return null;
        }

        return $path . (isset($parts['query']) ? '?' . $parts['query'] : '');
    }

    private function mediaReplacementKind(string $url): ?string
    {
        if (
            preg_match('#^https://www\.youtube(?:-nocookie)?\.com/embed/[A-Za-z0-9_-]{11}$#D', $url) === 1
            || preg_match('#^https://player\.vimeo\.com/video/[0-9]+$#D', $url) === 1
        ) {
            return 'embed';
        }

        $path = (string) (wp_parse_url($url, PHP_URL_PATH) ?: '');
        if (preg_match('/\.(?:png|jpe?g|webp|avif|gif)$/i', $path) === 1) return 'image';
        if (preg_match('/\.(?:pdf|docx|xlsx|pptx)$/i', $path) === 1) return 'document';
        if (preg_match('/\.(?:mp4|webm)$/i', $path) === 1) return 'video';
        return null;
    }

    /**
     * Retain a deterministic prefix that is guaranteed to fit the option byte
     * budget. The input has already been normalized across the full payload,
     * so dropping a tail cannot reintroduce a reverse-slug collision.
     *
     * @param array<string, array<string, string>> $mappings
     * @return array<string, array<string, string>>
     */
    private function boundUrlSlugMappingsByBytes(array $mappings): array
    {
        if (strlen(serialize($mappings)) <= self::URL_SLUG_MAPPINGS_MAX_BYTES) {
            return $mappings;
        }

        $bounded = [];
        $estimatedBytes = 32;

        foreach ($mappings as $language => $languageMappings) {
            if (!is_array($languageMappings)) {
                continue;
            }

            foreach ($languageMappings as $original => $translated) {
                if (!is_string($translated)) {
                    continue;
                }

                $newLanguage = !isset($bounded[$language]);
                // PHP's serialized string/array metadata is much smaller than
                // this reserve, including count digit growth at 10,000 rows.
                $entryBytes = strlen((string) $original) + strlen($translated) + 64;
                if ($newLanguage) {
                    $entryBytes += strlen((string) $language) + 64;
                }

                if ($estimatedBytes + $entryBytes > self::URL_SLUG_MAPPINGS_MAX_BYTES) {
                    break 2;
                }

                $bounded[$language][(string) $original] = $translated;
                $estimatedBytes += $entryBytes;
            }
        }

        // Keep the hard guarantee independent of the conservative estimate.
        while ($bounded !== [] && strlen(serialize($bounded)) > self::URL_SLUG_MAPPINGS_MAX_BYTES) {
            $lastLanguage = array_key_last($bounded);
            array_pop($bounded[$lastLanguage]);
            if ($bounded[$lastLanguage] === []) {
                unset($bounded[$lastLanguage]);
            }
        }

        return $bounded;
    }

    /**
     * Sanitizes the persisted nested map and removes every mapping involved in
     * a reverse collision. Keeping a source slug is safer than emitting a
     * translated path that cannot be resolved to one WordPress resource.
     *
     * @param mixed $value
     * @param string[] $allowedLanguages
     * @return array<string, array<string, string>>
     */
    private function normalizeUrlSlugMappings($value, array $allowedLanguages): array
    {
        if (!is_array($value)) {
            return [];
        }

        $rows = [];
        foreach ($value as $language => $languageMappings) {
            if (!is_array($languageMappings)) {
                continue;
            }

            foreach ($languageMappings as $originalSlug => $translatedSlug) {
                // PHP coerces canonical decimal string array keys (for example
                // "1279") to integers. Restore the persisted key's string
                // representation before applying the normal slug validation.
                if (is_int($originalSlug)) {
                    $originalSlug = (string) $originalSlug;
                }

                $rows[] = [
                    'langTo' => $language,
                    'originalSlug' => $originalSlug,
                    'translatedSlug' => $translatedSlug,
                ];

                if (count($rows) > self::URL_SLUG_MAPPINGS_MAX) {
                    break 2;
                }
            }
        }

        if (count($rows) > self::URL_SLUG_MAPPINGS_MAX) {
            return [];
        }

        return $this->normalizeRuntimeUrlSlugs($rows, $allowedLanguages);
    }

    /**
     * @param mixed[] $rows
     * @param string[] $allowedLanguages
     * @return array<string, array<string, string>>
     */
    private function normalizeRuntimeUrlSlugs(array $rows, array $allowedLanguages): array
    {
        if (count($rows) > self::URL_SLUG_MAPPINGS_MAX) {
            return [];
        }

        $originalCounts = [];
        foreach ($rows as $row) {
            if (!is_array($row)) {
                continue;
            }

            $language = $this->sanitizeLanguage((string) ($row['langTo'] ?? ''));
            $original = $this->sanitizeUrlSlugSegment($row['originalSlug'] ?? null);
            if (
                $language === ''
                || !in_array($language, $allowedLanguages, true)
                || $original === ''
                || WordPressInfrastructure::isReservedSlugSegment($original)
            ) {
                continue;
            }

            $originalCounts[$language][$original] = ($originalCounts[$language][$original] ?? 0) + 1;
        }

        $mappings = [];
        $translatedOwners = [];
        $blockedOriginals = [];
        $blockedTranslations = [];
        $seenOriginals = [];
        $acceptedCount = 0;

        foreach ($rows as $row) {
            if (!is_array($row)) {
                continue;
            }

            $language = $this->sanitizeLanguage((string) ($row['langTo'] ?? ''));
            $original = $this->sanitizeUrlSlugSegment($row['originalSlug'] ?? null);
            $translated = $this->sanitizeUrlSlugSegment($row['translatedSlug'] ?? null);

            if (
                $language === ''
                || !in_array($language, $allowedLanguages, true)
                || $original === ''
                || $translated === ''
                || WordPressInfrastructure::isReservedSlugSegment($original)
                || WordPressInfrastructure::isReservedSlugSegment($translated)
                || ($originalCounts[$language][$original] ?? 0) !== 1
                || ($translated !== $original && isset($originalCounts[$language][$translated]))
                || isset($blockedOriginals[$language][$original])
            ) {
                continue;
            }

            if (isset($seenOriginals[$language][$original])) {
                $existingTranslation = $mappings[$language][$original] ?? null;
                if ($existingTranslation !== null) {
                    unset($mappings[$language][$original], $translatedOwners[$language][$existingTranslation]);
                    $acceptedCount--;
                }
                $blockedOriginals[$language][$original] = true;
                continue;
            }
            $seenOriginals[$language][$original] = true;

            if (isset($blockedTranslations[$language][$translated])) {
                continue;
            }

            $existingOwner = $translatedOwners[$language][$translated] ?? null;
            if ($existingOwner !== null && $existingOwner !== $original) {
                unset($mappings[$language][$existingOwner], $translatedOwners[$language][$translated]);
                $blockedTranslations[$language][$translated] = true;
                $acceptedCount--;
                continue;
            }

            $mappings[$language][$original] = $translated;
            $translatedOwners[$language][$translated] = $original;
            $acceptedCount++;

            if ($acceptedCount >= self::URL_SLUG_MAPPINGS_MAX) {
                break;
            }
        }

        return array_filter($mappings, static fn (array $languageMappings): bool => $languageMappings !== []);
    }

    /**
     * @param mixed $value
     */
    private function sanitizeUrlSlugSegment($value): string
    {
        if (!is_string($value)) {
            return '';
        }

        $segment = rawurldecode(trim($value));
        $segment = function_exists('mb_strtolower')
            ? mb_strtolower($segment, 'UTF-8')
            : strtolower($segment);
        $segment = preg_replace_callback(
            '/%[0-9a-f]{2}/i',
            static fn (array $match): string => strtoupper($match[0]),
            $segment
        ) ?? $segment;

        if (
            $segment === ''
            || $segment === '.'
            || $segment === '..'
            || strlen($segment) > self::URL_SLUG_SEGMENT_MAX_LEN
            || preg_match('//u', $segment) !== 1
            || preg_match('/[\x00-\x20\x7f\/\\\\?#]/u', $segment) === 1
        ) {
            return '';
        }

        return rawurlencode($segment);
    }

    private function sanitizeHost(string $host): string
    {
        $host = strtolower(trim($host));
        $host = preg_replace('#^https?://#', '', $host);
        $host = trim((string) wp_parse_url('https://' . $host, PHP_URL_HOST));

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
        $path = wp_parse_url($urlOrPath, PHP_URL_PATH);
        $query = wp_parse_url($urlOrPath, PHP_URL_QUERY);

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
