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
 *   - Block inserter → "Deepglot Sprachschalter" → drop into any
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
                ['wp-blocks', 'wp-element', 'wp-server-side-render', 'wp-i18n'],
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
        }

        register_block_type('deepglot/switcher', [
            'api_version'     => 3,
            'title'           => __('Deepglot Sprachschalter', 'deepglot'),
            'category'        => 'widgets',
            'icon'            => 'translation',
            'description'     => __('Zeigt den Deepglot Sprachschalter — Stile/Flagge/Reihenfolge folgen den Plugin-Einstellungen.', 'deepglot'),
            'editor_script'   => 'deepglot-switcher-block',
            'render_callback' => [$this, 'render'],
            'supports'        => [
                'html'  => false,
                'align' => ['left', 'center', 'right'],
            ],
        ]);
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
        $body = $this->switcher->renderShortcode([]);
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
