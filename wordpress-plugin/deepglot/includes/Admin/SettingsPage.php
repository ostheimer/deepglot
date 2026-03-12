<?php

namespace Deepglot\Admin;

use Deepglot\Config\Options;

/**
 * Admin settings page with guided onboarding wizard.
 *
 * Renders a step-by-step setup guide when the plugin is not yet configured,
 * and a compact settings form with a live connection indicator once configured.
 */
class SettingsPage
{
    private Options $options;

    private const DASHBOARD_URL = 'https://deepglot-five.vercel.app';

    public function __construct(Options $options)
    {
        $this->options = $options;
    }

    public function register(): void
    {
        add_action('admin_menu', [$this, 'registerMenu']);
        add_action('admin_init', [$this, 'registerSettings']);
        add_action('admin_enqueue_scripts', [$this, 'enqueueStyles']);
    }

    public function registerMenu(): void
    {
        add_options_page(
            __('Deepglot', 'deepglot'),
            __('Deepglot', 'deepglot'),
            'manage_options',
            'deepglot',
            [$this, 'render']
        );
    }

    public function registerSettings(): void
    {
        register_setting('deepglot', Options::OPTION_KEY, [$this->options, 'sanitize']);
    }

    public function enqueueStyles(string $hook): void
    {
        if ($hook !== 'settings_page_deepglot') {
            return;
        }
        // Inline styles keep the plugin dependency-free.
        add_action('admin_head', [$this, 'printStyles']);
    }

    public function printStyles(): void
    {
        ?>
        <style>
        /* ── Deepglot Admin Styles ── */
        #deepglot-wrap { max-width: 760px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        #deepglot-wrap h1 { display: flex; align-items: center; gap: 10px; font-size: 1.5rem; margin-bottom: 0; }
        #deepglot-wrap .dg-logo { width: 28px; height: 28px; background: #4f46e5; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; color: #fff; font-size: 14px; font-weight: 700; flex-shrink: 0; }

        /* Status badge */
        .dg-status { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 600; margin-left: 4px; }
        .dg-status.active { background: #dcfce7; color: #166534; }
        .dg-status.inactive { background: #fee2e2; color: #991b1b; }
        .dg-status.unconfigured { background: #fef3c7; color: #92400e; }

        /* Setup wizard */
        .dg-wizard { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 28px 32px; margin: 20px 0; }
        .dg-wizard-header { margin-bottom: 24px; }
        .dg-wizard-header h2 { margin: 0 0 6px; font-size: 1.1rem; color: #111827; }
        .dg-wizard-header p { margin: 0; color: #6b7280; font-size: 0.875rem; }
        .dg-steps { display: flex; flex-direction: column; gap: 0; margin-bottom: 28px; }
        .dg-step { display: flex; gap: 16px; padding: 18px 0; border-bottom: 1px solid #f3f4f6; }
        .dg-step:last-child { border-bottom: none; }
        .dg-step-num { flex-shrink: 0; width: 28px; height: 28px; border-radius: 50%; background: #4f46e5; color: #fff; font-size: 13px; font-weight: 700; display: flex; align-items: center; justify-content: center; margin-top: 2px; }
        .dg-step-num.done { background: #16a34a; }
        .dg-step-body { flex: 1; }
        .dg-step-body h3 { margin: 0 0 6px; font-size: 0.9375rem; color: #111827; }
        .dg-step-body p { margin: 0 0 12px; color: #6b7280; font-size: 0.875rem; line-height: 1.5; }

        /* Form elements */
        .dg-field { margin-bottom: 14px; }
        .dg-field label { display: block; font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 5px; }
        .dg-field input[type="text"],
        .dg-field input[type="url"],
        .dg-field input[type="password"] { width: 100%; max-width: 460px; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 13px; font-family: monospace; color: #111827; }
        .dg-field input:focus { outline: none; border-color: #4f46e5; box-shadow: 0 0 0 2px rgba(79,70,229,.15); }
        .dg-field .description { margin: 5px 0 0; font-size: 12px; color: #9ca3af; }
        .dg-lang-row { display: flex; gap: 10px; align-items: flex-start; flex-wrap: wrap; }
        .dg-lang-row .dg-field { flex: 1; min-width: 140px; }

        /* Buttons */
        .dg-btn-primary { background: #4f46e5; color: #fff; border: none; padding: 9px 20px; border-radius: 7px; font-size: 13px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
        .dg-btn-primary:hover { background: #4338ca; }
        .dg-btn-outline { background: transparent; color: #4f46e5; border: 1.5px solid #4f46e5; padding: 8px 18px; border-radius: 7px; font-size: 13px; font-weight: 600; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; }
        .dg-btn-outline:hover { background: #eef2ff; color: #4338ca; border-color: #4338ca; }

        /* Alert */
        .dg-alert { padding: 12px 16px; border-radius: 8px; font-size: 13px; margin-bottom: 16px; }
        .dg-alert.success { background: #f0fdf4; border: 1px solid #bbf7d0; color: #166534; }
        .dg-alert.warning { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; }
        .dg-alert.info { background: #eff6ff; border: 1px solid #bfdbfe; color: #1e40af; }

        /* Toggle */
        .dg-toggle-row { display: flex; align-items: center; gap: 12px; }
        .dg-toggle-row label { font-size: 13px; color: #374151; cursor: pointer; }
        input[type="checkbox"].dg-toggle { width: 36px; height: 20px; appearance: none; background: #d1d5db; border-radius: 10px; cursor: pointer; position: relative; transition: background .2s; }
        input[type="checkbox"].dg-toggle:checked { background: #4f46e5; }
        input[type="checkbox"].dg-toggle::after { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; background: #fff; border-radius: 50%; transition: left .2s; box-shadow: 0 1px 3px rgba(0,0,0,.2); }
        input[type="checkbox"].dg-toggle:checked::after { left: 18px; }

        /* Advanced section */
        .dg-advanced-toggle { font-size: 12px; color: #6b7280; cursor: pointer; margin-top: 8px; display: inline-flex; align-items: center; gap: 4px; }
        .dg-advanced-toggle:hover { color: #4f46e5; }
        .dg-advanced { display: none; margin-top: 14px; padding-top: 14px; border-top: 1px dashed #e5e7eb; }
        .dg-advanced.open { display: block; }
        .dg-advanced textarea { width: 100%; max-width: 460px; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 12px; font-family: monospace; color: #374151; resize: vertical; }

        /* Footer actions */
        .dg-actions { display: flex; gap: 10px; align-items: center; padding-top: 4px; }
        .dg-help { font-size: 12px; color: #9ca3af; margin-top: 8px; }
        .dg-help a { color: #4f46e5; text-decoration: none; }
        </style>
        <?php
    }

    public function render(): void
    {
        if (!current_user_can('manage_options')) {
            return;
        }

        $settings   = $this->options->all();
        $isSetup    = !empty($settings['api_key']);
        $isEnabled  = !empty($settings['enabled']);
        $optKey     = Options::OPTION_KEY;
        $dashUrl    = self::DASHBOARD_URL;

        if ($isEnabled && $isSetup) {
            $statusClass = 'active';
            $statusLabel = __('Aktiv', 'deepglot');
        } elseif ($isSetup) {
            $statusClass = 'inactive';
            $statusLabel = __('Deaktiviert', 'deepglot');
        } else {
            $statusClass = 'unconfigured';
            $statusLabel = __('Einrichtung erforderlich', 'deepglot');
        }
        ?>
        <div class="wrap" id="deepglot-wrap">
            <h1>
                <span class="dg-logo">D</span>
                Deepglot
                <span class="dg-status <?php echo esc_attr($statusClass); ?>">
                    <?php echo esc_html($statusLabel); ?>
                </span>
            </h1>

            <?php settings_errors('deepglot_settings'); ?>

            <?php if (!$isSetup) : ?>
                <!-- ── SETUP WIZARD (first-time) ── -->
                <div class="dg-alert info" style="margin-top:16px;">
                    <?php esc_html_e('Willkommen bei Deepglot! Folge den drei Schritten unten, um die Übersetzung deiner Website zu aktivieren.', 'deepglot'); ?>
                </div>
            <?php endif; ?>

            <form method="post" action="options.php">
                <?php settings_fields('deepglot'); ?>

                <div class="dg-wizard">

                    <?php if (!$isSetup) : ?>
                    <div class="dg-wizard-header">
                        <h2><?php esc_html_e('Deepglot einrichten', 'deepglot'); ?></h2>
                        <p><?php esc_html_e('Du benötigst nur einen API-Key aus dem Deepglot-Dashboard – das dauert weniger als zwei Minuten.', 'deepglot'); ?></p>
                    </div>
                    <?php endif; ?>

                    <div class="dg-steps">

                        <!-- Step 1: API-Key -->
                        <div class="dg-step">
                            <div class="dg-step-num <?php echo $isSetup ? 'done' : ''; ?>">
                                <?php echo $isSetup ? '✓' : '1'; ?>
                            </div>
                            <div class="dg-step-body">
                                <h3><?php esc_html_e('API-Key eintragen', 'deepglot'); ?></h3>
                                <?php if (!$isSetup) : ?>
                                <p>
                                    <?php esc_html_e('Erstelle ein kostenloses Konto auf deepglot.app, lege ein Projekt für deine Website an und kopiere den API-Key.', 'deepglot'); ?>
                                    <br>
                                    <a href="<?php echo esc_url($dashUrl . '/projects/new'); ?>" target="_blank" rel="noopener" class="dg-btn-outline" style="margin-top:10px; display:inline-flex;">
                                        ↗ <?php esc_html_e('Zum Dashboard – API-Key erstellen', 'deepglot'); ?>
                                    </a>
                                </p>
                                <?php endif; ?>
                                <div class="dg-field">
                                    <label for="dg_api_key"><?php esc_html_e('API-Key', 'deepglot'); ?></label>
                                    <input
                                        id="dg_api_key"
                                        type="text"
                                        name="<?php echo esc_attr($optKey); ?>[api_key]"
                                        value="<?php echo esc_attr($settings['api_key']); ?>"
                                        placeholder="dg_live_..."
                                        autocomplete="off"
                                        spellcheck="false"
                                    />
                                    <p class="description">
                                        <?php esc_html_e('Den vollständigen Schlüssel findest du unter Einstellungen → API-Keys in deinem Deepglot-Projekt.', 'deepglot'); ?>
                                    </p>
                                </div>
                                <div class="dg-field">
                                    <label for="dg_api_base_url"><?php esc_html_e('Backend-URL', 'deepglot'); ?></label>
                                    <input
                                        id="dg_api_base_url"
                                        type="url"
                                        name="<?php echo esc_attr($optKey); ?>[api_base_url]"
                                        value="<?php echo esc_attr($settings['api_base_url']); ?>"
                                    />
                                    <p class="description">
                                        <?php esc_html_e('Standard: https://deepglot-five.vercel.app/api – nur ändern bei Self-Hosting.', 'deepglot'); ?>
                                    </p>
                                </div>
                            </div>
                        </div>

                        <!-- Step 2: Languages -->
                        <div class="dg-step">
                            <div class="dg-step-num <?php echo $isSetup ? 'done' : '2'; ?>">
                                <?php echo $isSetup ? '✓' : '2'; ?>
                            </div>
                            <div class="dg-step-body">
                                <h3><?php esc_html_e('Sprachen konfigurieren', 'deepglot'); ?></h3>
                                <?php if (!$isSetup) : ?>
                                <p><?php esc_html_e('Lege die Originalsprache und die gewünschten Übersetzungssprachen fest.', 'deepglot'); ?></p>
                                <?php endif; ?>
                                <div class="dg-lang-row">
                                    <div class="dg-field">
                                        <label for="dg_source_lang"><?php esc_html_e('Originalsprache', 'deepglot'); ?></label>
                                        <input
                                            id="dg_source_lang"
                                            type="text"
                                            name="<?php echo esc_attr($optKey); ?>[source_language]"
                                            value="<?php echo esc_attr($settings['source_language']); ?>"
                                            placeholder="de"
                                            style="max-width:90px;"
                                        />
                                    </div>
                                    <div class="dg-field" style="flex:2;">
                                        <label for="dg_target_langs"><?php esc_html_e('Zielsprachen', 'deepglot'); ?></label>
                                        <input
                                            id="dg_target_langs"
                                            type="text"
                                            name="<?php echo esc_attr($optKey); ?>[target_languages]"
                                            value="<?php echo esc_attr(implode(', ', (array) $settings['target_languages'])); ?>"
                                            placeholder="en, fr, es"
                                        />
                                        <p class="description"><?php esc_html_e('Kommagetrennte ISO-639-1-Codes, z. B. en, fr, it', 'deepglot'); ?></p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Step 3: Enable -->
                        <div class="dg-step">
                            <div class="dg-step-num <?php echo $isEnabled ? 'done' : ($isSetup ? '3' : '3'); ?>">
                                <?php echo $isEnabled ? '✓' : '3'; ?>
                            </div>
                            <div class="dg-step-body">
                                <h3><?php esc_html_e('Übersetzung aktivieren', 'deepglot'); ?></h3>
                                <?php if (!$isSetup) : ?>
                                <p><?php esc_html_e('Sobald API-Key und Sprachen gespeichert sind, aktiviere die automatische Übersetzung hier.', 'deepglot'); ?></p>
                                <?php endif; ?>
                                <div class="dg-toggle-row">
                                    <input
                                        type="checkbox"
                                        id="dg_enabled"
                                        name="<?php echo esc_attr($optKey); ?>[enabled]"
                                        value="1"
                                        class="dg-toggle"
                                        <?php checked(!empty($settings['enabled'])); ?>
                                    />
                                    <label for="dg_enabled">
                                        <?php esc_html_e('Deepglot für alle Frontend-Anfragen aktiv schalten', 'deepglot'); ?>
                                    </label>
                                </div>
                                <?php if ($isEnabled) : ?>
                                    <p style="margin:10px 0 0; font-size:12px; color:#16a34a; font-weight:600;">
                                        ✓ <?php
                                            $langList = implode(', ', array_map('strtoupper', (array) $settings['target_languages']));
                                            printf(
                                                /* translators: %1$s: source language, %2$s: target languages */
                                                esc_html__('Aktiv – Seiten werden von %1$s nach %2$s übersetzt unter /%3$s/ihre-seite/', 'deepglot'),
                                                esc_html(strtoupper($settings['source_language'])),
                                                esc_html($langList),
                                                esc_html($settings['target_languages'][0] ?? 'en')
                                            );
                                        ?>
                                    </p>
                                <?php endif; ?>

                                <!-- Optional browser-language redirect -->
                                <div class="dg-toggle-row" style="margin-top:14px;">
                                    <input
                                        type="checkbox"
                                        id="dg_auto_redirect"
                                        name="<?php echo esc_attr($optKey); ?>[auto_redirect]"
                                        value="1"
                                        class="dg-toggle"
                                        <?php checked(!empty($settings['auto_redirect'])); ?>
                                    />
                                    <label for="dg_auto_redirect">
                                        <?php esc_html_e('Besucher anhand der Browsersprache automatisch weiterleiten (optional)', 'deepglot'); ?>
                                    </label>
                                </div>
                            </div>
                        </div>

                    </div><!-- /.dg-steps -->

                    <!-- Advanced / Exclusions -->
                    <span class="dg-advanced-toggle" onclick="var el=document.getElementById('dg-advanced');el.classList.toggle('open');this.textContent=el.classList.contains('open')?'▲ <?php echo esc_js(__('Erweiterte Einstellungen ausblenden', 'deepglot')); ?>':'▼ <?php echo esc_js(__('Erweiterte Einstellungen anzeigen', 'deepglot')); ?>';">
                        ▼ <?php esc_html_e('Erweiterte Einstellungen anzeigen', 'deepglot'); ?>
                    </span>
                    <div id="dg-advanced" class="dg-advanced">
                        <div class="dg-field">
                            <label for="dg_exclude_urls"><?php esc_html_e('Ausgeschlossene URLs', 'deepglot'); ?></label>
                            <textarea id="dg_exclude_urls" name="<?php echo esc_attr($optKey); ?>[exclude_urls]" rows="4" placeholder="/kontakt&#10;/impressum"><?php echo esc_textarea($settings['exclude_urls']); ?></textarea>
                            <p class="description"><?php esc_html_e('Eine URL oder ein Muster pro Zeile.', 'deepglot'); ?></p>
                        </div>
                        <div class="dg-field">
                            <label for="dg_exclude_selectors"><?php esc_html_e('Ausgeschlossene CSS-Selektoren', 'deepglot'); ?></label>
                            <textarea id="dg_exclude_selectors" name="<?php echo esc_attr($optKey); ?>[exclude_selectors]" rows="4" placeholder=".no-translate&#10;#sidebar"><?php echo esc_textarea($settings['exclude_selectors']); ?></textarea>
                            <p class="description"><?php esc_html_e('Eine CSS-Klasse, ID oder ein Selektor pro Zeile.', 'deepglot'); ?></p>
                        </div>
                    </div>

                    <div class="dg-actions" style="margin-top:24px;">
                        <button type="submit" class="dg-btn-primary">
                            <?php esc_html_e('Einstellungen speichern', 'deepglot'); ?>
                        </button>
                        <a href="<?php echo esc_url($dashUrl); ?>" target="_blank" rel="noopener" class="dg-btn-outline">
                            ↗ Dashboard
                        </a>
                    </div>

                    <p class="dg-help">
                        <?php
                        printf(
                            /* translators: %s: dashboard url */
                            esc_html__('Hilfe & Dokumentation: %s', 'deepglot'),
                            '<a href="' . esc_url($dashUrl) . '" target="_blank" rel="noopener">' . esc_html($dashUrl) . '</a>'
                        );
                        ?>
                    </p>

                </div><!-- /.dg-wizard -->
            </form>
        </div>
        <?php
    }
}
