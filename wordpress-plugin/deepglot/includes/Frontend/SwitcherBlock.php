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

    /**
     * Render callback. WP passes block attributes as the first argument,
     * but our switcher reads everything off Options so attributes are
     * intentionally ignored — the dashboard / settings page is the
     * single source of truth for switcher appearance.
     *
     * @param array<string,mixed> $attributes
     */
    public function render(array $attributes = []): string
    {
        return $this->switcher->renderShortcode([]);
    }
}
