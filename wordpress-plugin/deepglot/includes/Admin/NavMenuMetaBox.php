<?php

namespace Deepglot\Admin;

/**
 * Adds a meta-box to Appearance → Menus that lets a site owner drop the
 * Deepglot language switcher into any nav menu with a single click.
 *
 * Mirrors the standard WP "Custom Links" UX: the user picks the
 * "Sprachschalter" item, optionally toggles dropdown / hide-current
 * sub-modes, hits "Zum Menü hinzufügen". NavMenuSwitcher then expands
 * that placeholder into one item per configured language at render
 * time.
 */
class NavMenuMetaBox
{
    public function register(): void
    {
        add_action('admin_init', [$this, 'addMetaBox']);
        add_action('admin_enqueue_scripts', [$this, 'enqueueAssets']);
    }

    public function enqueueAssets(string $hook): void
    {
        if ($hook !== 'nav-menus.php') {
            return;
        }

        wp_enqueue_script(
            'deepglot-nav-menu-metabox',
            DEEPGLOT_PLUGIN_URL . 'assets/js/nav-menu-metabox.js',
            ['nav-menu'],
            DEEPGLOT_PLUGIN_VERSION,
            true
        );
        wp_localize_script(
            'deepglot-nav-menu-metabox',
            'deepglotNavMenuMetabox',
            ['label' => __('Sprachschalter', 'deepglot')]
        );
    }

    public function addMetaBox(): void
    {
        add_meta_box(
            'deepglot-nav-menu',
            __('Deepglot Sprachschalter', 'deepglot'),
            [$this, 'render'],
            'nav-menus',
            'side',
            'default'
        );
    }

    public function render(): void
    {
        global $nav_menu_selected_id;
        $menuId = isset($nav_menu_selected_id) ? (int) $nav_menu_selected_id : 0;
        ?>
        <div id="deepglot-nav-menu-box" class="posttypediv">
            <p style="margin:6px 0 10px; color:#50575e; font-size:12px;">
                <?php esc_html_e('Fügt einen Sprachschalter-Eintrag hinzu, der beim Anzeigen automatisch in einen Eintrag pro Sprache aufgeklappt wird.', 'deepglot'); ?>
            </p>
            <p style="margin:10px 0 4px;">
                <strong><?php esc_html_e('Anzeige-Modus', 'deepglot'); ?></strong>
            </p>
            <p style="margin:0 0 4px;">
                <label>
                    <input type="radio" name="deepglot-nav-mode" value="list" checked>
                    <?php esc_html_e('Liste (jede Sprache als eigener Menüpunkt)', 'deepglot'); ?>
                </label>
            </p>
            <p style="margin:0 0 4px;">
                <label>
                    <input type="radio" name="deepglot-nav-mode" value="dropdown">
                    <?php esc_html_e('Dropdown (aktive Sprache als Parent, Alternativen als Submenu)', 'deepglot'); ?>
                </label>
            </p>
            <p style="margin:10px 0 4px;">
                <label>
                    <input type="checkbox" id="deepglot-nav-hide-current">
                    <?php esc_html_e('Aktive Sprache aus der Liste ausblenden', 'deepglot'); ?>
                </label>
            </p>
            <p class="button-controls" style="margin-top:12px;">
                <span class="add-to-menu">
                    <button
                        type="button"
                        class="button-secondary submit-add-to-menu right"
                        id="deepglot-nav-submit"
                        <?php disabled($menuId, 0); ?>>
                        <?php esc_html_e('Zum Menü hinzufügen', 'deepglot'); ?>
                    </button>
                    <span class="spinner"></span>
                </span>
            </p>
        </div>

        <?php
    }
}
