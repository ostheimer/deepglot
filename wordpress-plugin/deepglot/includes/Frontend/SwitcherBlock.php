<?php

namespace Deepglot\Frontend;

/**
 * Gutenberg / Block Editor integration: a dynamic
 * `deepglot/switcher` block whose render callback returns the same
 * markup as the [deepglot_switcher] shortcode. Keeping it dynamic
 * (server-rendered) means the HTML stays in lockstep with shortcode,
 * widget, nav-menu and auto-inject output — no second copy of the
 * markup to drift.
 *
 * Site-owner UX:
 *   - Block inserter → "Deepglot language switcher" → drop into any
 *     block-themed page / FSE template / Post Content area.
 *   - Editor preview is server-rendered via wp.serverSideRender, so
 *     what the editor shows = what the visitor sees.
 */
class SwitcherBlock
{
    private LanguageSwitcher $switcher;

    public function __construct(LanguageSwitcher $switcher)
    {
        $this->switcher = $switcher;
    }

    public function register(): void
    {
        add_action('init', [$this, 'registerBlock']);
    }

    public function registerBlock(): void
    {
        // The editor script is a tiny `wp.serverSideRender` wrapper so
        // the block previews live inside the editor without bundling a
        // separate save() output.
        if (function_exists('wp_register_script')) {
            wp_register_script(
                'deepglot-switcher-block',
                DEEPGLOT_PLUGIN_URL . 'assets/js/block-switcher.js',
                ['wp-blocks', 'wp-element', 'wp-server-side-render', 'wp-i18n', 'wp-components', 'wp-block-editor'],
                DEEPGLOT_PLUGIN_VERSION,
                true
            );
        }

        if (function_exists('wp_set_script_translations')) {
            wp_set_script_translations(
                'deepglot-switcher-block',
                'deepglot',
                DEEPGLOT_PLUGIN_DIR . 'languages'
            );
            if (function_exists('add_filter')) {
                add_filter('pre_load_script_translations', [$this, 'mergeOfficialScriptTranslations'], 10, 4);
            }
        }

        register_block_type('deepglot/switcher', [
            'api_version'     => 3,
            'title'           => __('Deepglot language switcher', 'deepglot'),
            'category'        => 'widgets',
            'icon'            => 'translation',
            'description'     => __('Shows the Deepglot language switcher. Style, flag, and language order follow the plugin settings.', 'deepglot'),
            'editor_script'   => 'deepglot-switcher-block',
            'render_callback' => [$this, 'render'],
            'attributes'      => [
                'instanceId' => [
                    'type'    => 'string',
                    'default' => 'default',
                ],
            ],
            'supports'        => [
                'html'  => false,
                'align' => ['left', 'center', 'right'],
            ],
        ]);
    }

    /**
     * Keep newly keyed bundled JS strings when an older system pack exists,
     * while letting approved system translations of current keys win.
     */
    public function mergeOfficialScriptTranslations($translations, $file, $handle, $domain)
    {
        if ($translations !== null || $handle !== 'deepglot-switcher-block' || $domain !== 'deepglot' || !is_string($file)) {
            return $translations;
        }

        $locale = determine_locale();
        if (!preg_match('/^[a-z]{2,3}(?:_[A-Za-z0-9]{2,8}){0,2}$/', $locale)) {
            return null;
        }

        $filename = 'deepglot-' . $locale . '-' . md5('assets/js/block-switcher.js') . '.json';
        if (basename($file) !== $filename || realpath(dirname($file)) !== realpath(DEEPGLOT_PLUGIN_DIR . 'languages')) {
            return null;
        }

        $officialFile = WP_LANG_DIR . '/plugins/' . $filename;
        if (!is_readable($file) || !is_readable($officialFile)) {
            return null;
        }

        $bundle = json_decode((string) file_get_contents($file), true);
        $official = json_decode((string) file_get_contents($officialFile), true);
        if (!is_array($bundle) || !is_array($official)
            || !isset($bundle['locale_data']['messages'], $official['locale_data']['messages'])
            || !is_array($bundle['locale_data']['messages']) || !is_array($official['locale_data']['messages'])) {
            return null;
        }

        $bundle['locale_data']['messages'] = array_replace(
            $bundle['locale_data']['messages'],
            $official['locale_data']['messages']
        );

        return wp_json_encode($bundle);
    }

    /** Valid alignment values declared via `supports.align`. */
    private const ALLOWED_ALIGNMENTS = ['left', 'center', 'right'];

    /**
     * Render callback. Switcher appearance (style, flags, order, …) is
     * driven by Plugin Settings — block attributes are intentionally
     * ignored for those. The exception is `align`, which the block
     * advertises via `supports.align`: we must propagate the editor
     * choice to a wrapper `align<value>` class so theme alignment CSS
     * actually applies on the frontend.
     *
     * @param array<string,mixed> $attributes
     */
    public function render(array $attributes = []): string
    {
        $instanceId = isset($attributes['instanceId']) ? (string) $attributes['instanceId'] : 'default';
        $body = $this->switcher->renderShortcode(['instance' => $instanceId]);
        if ($body === '') {
            return '';
        }

        $align = isset($attributes['align']) ? (string) $attributes['align'] : '';
        if (!in_array($align, self::ALLOWED_ALIGNMENTS, true)) {
            return $body;
        }

        return sprintf(
            '<div class="wp-block-deepglot-switcher align%s">%s</div>',
            esc_attr($align),
            $body
        );
    }
}
