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

    private const DASHBOARD_URL = 'https://deepglot.ai';

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

        /* Switcher section */
        .dg-section-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 20px; max-width: 460px; }
        .dg-section-grid .dg-field { margin-bottom: 0; }
        .dg-section-grid select { width: 100%; padding: 8px 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 13px; }

        /* Drag-and-drop sortable list */
        .dg-sortable { list-style: none; padding: 0; margin: 8px 0 0; max-width: 460px; }
        .dg-sortable-item {
            display: flex; align-items: center; gap: 10px;
            padding: 10px 14px;
            background: #f9fafb;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            margin-bottom: 6px;
            cursor: grab;
            user-select: none;
            font-size: 13px;
            transition: background .12s, border-color .12s;
        }
        .dg-sortable-item:hover { background: #f3f4f6; }
        .dg-sortable-item.dragging { opacity: 0.4; cursor: grabbing; }
        .dg-sortable-item.drag-over { border-color: #4f46e5; background: #eef2ff; }
        .dg-drag-handle { color: #9ca3af; font-size: 14px; line-height: 1; }
        .dg-sortable-label { font-weight: 600; color: #111827; letter-spacing: 0.5px; }
        .dg-sortable-native { color: #6b7280; font-weight: 400; margin-left: 4px; }
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
                                        <?php esc_html_e('Standard: https://deepglot.ai/api – nur ändern bei Self-Hosting.', 'deepglot'); ?>
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
                            <label for="dg_routing_mode"><?php esc_html_e('Routing-Modus', 'deepglot'); ?></label>
                            <select id="dg_routing_mode" name="<?php echo esc_attr($optKey); ?>[routing_mode]" style="min-width:220px;">
                                <option value="PATH_PREFIX" <?php selected(($settings['routing_mode'] ?? 'PATH_PREFIX'), 'PATH_PREFIX'); ?>>
                                    <?php esc_html_e('Pfad-Präfix (/en/meine-seite)', 'deepglot'); ?>
                                </option>
                                <option value="SUBDOMAIN" <?php selected(($settings['routing_mode'] ?? 'PATH_PREFIX'), 'SUBDOMAIN'); ?>>
                                    <?php esc_html_e('Subdomains (en.example.com)', 'deepglot'); ?>
                                </option>
                            </select>
                            <p class="description"><?php esc_html_e('Pfad-Präfix bleibt der Standard. Für Subdomains braucht jede aktive Zielsprache einen Host.', 'deepglot'); ?></p>
                        </div>
                        <div class="dg-field">
                            <label for="dg_domain_mappings"><?php esc_html_e('Domain-Zuordnungen', 'deepglot'); ?></label>
                            <textarea id="dg_domain_mappings" name="<?php echo esc_attr($optKey); ?>[domain_mappings]" rows="4" placeholder="en=en.example.com&#10;fr=fr.example.com"><?php
                                $mappingLines = [];
                                foreach ((array) ($settings['domain_mappings'] ?? []) as $lang => $host) {
                                    $mappingLines[] = $lang . '=' . $host;
                                }
                                echo esc_textarea(implode("\n", $mappingLines));
                            ?></textarea>
                            <p class="description"><?php esc_html_e('Format: sprachcode=host, eine Zuordnung pro Zeile.', 'deepglot'); ?></p>
                        </div>
                        <div class="dg-toggle-row" style="margin-top:14px;">
                            <input
                                type="checkbox"
                                id="dg_translate_emails"
                                name="<?php echo esc_attr($optKey); ?>[translate_emails]"
                                value="1"
                                class="dg-toggle"
                                <?php checked(!empty($settings['translate_emails'])); ?>
                            />
                            <label for="dg_translate_emails">
                                <?php esc_html_e('WooCommerce- und wp_mail-E-Mails übersetzen', 'deepglot'); ?>
                            </label>
                        </div>
                        <div class="dg-toggle-row" style="margin-top:14px;">
                            <input
                                type="checkbox"
                                id="dg_translate_search"
                                name="<?php echo esc_attr($optKey); ?>[translate_search]"
                                value="1"
                                class="dg-toggle"
                                <?php checked(!empty($settings['translate_search'])); ?>
                            />
                            <label for="dg_translate_search">
                                <?php esc_html_e('Suche in der Besuchersprache ausführen', 'deepglot'); ?>
                            </label>
                        </div>
                        <div class="dg-toggle-row" style="margin-top:14px;">
                            <input
                                type="checkbox"
                                id="dg_translate_amp"
                                name="<?php echo esc_attr($optKey); ?>[translate_amp]"
                                value="1"
                                class="dg-toggle"
                                <?php checked(!empty($settings['translate_amp'])); ?>
                            />
                            <label for="dg_translate_amp">
                                <?php esc_html_e('AMP-Seiten übersetzen', 'deepglot'); ?>
                            </label>
                        </div>
                        <div class="dg-field">
                            <label for="dg_exclude_selectors"><?php esc_html_e('Ausgeschlossene CSS-Selektoren', 'deepglot'); ?></label>
                            <textarea id="dg_exclude_selectors" name="<?php echo esc_attr($optKey); ?>[exclude_selectors]" rows="4" placeholder=".no-translate&#10;#sidebar"><?php echo esc_textarea($settings['exclude_selectors']); ?></textarea>
                            <p class="description"><?php esc_html_e('Eine CSS-Klasse, ID oder ein Selektor pro Zeile.', 'deepglot'); ?></p>
                        </div>
                    </div>

                </div><!-- /.dg-wizard (main) -->

                <?php
                // ---------------------------------------------------------------
                // Sprachumschalter / Language switcher appearance section
                // ---------------------------------------------------------------
                $allLangs = array_values(array_unique(array_merge(
                    [(string) ($settings['source_language'] ?? 'de')],
                    (array) ($settings['target_languages'] ?? [])
                )));
                $storedOrder = (array) ($settings['switcher_language_order'] ?? []);
                $orderedLangs = [];
                foreach ($storedOrder as $lang) {
                    if (in_array($lang, $allLangs, true) && !in_array($lang, $orderedLangs, true)) {
                        $orderedLangs[] = $lang;
                    }
                }
                foreach ($allLangs as $lang) {
                    if (!in_array($lang, $orderedLangs, true)) {
                        $orderedLangs[] = $lang;
                    }
                }
                $nativeLabels = [
                    'de' => 'Deutsch', 'en' => 'English', 'fr' => 'Français', 'es' => 'Español',
                    'it' => 'Italiano', 'pt' => 'Português', 'nl' => 'Nederlands', 'pl' => 'Polski',
                    'ru' => 'Русский', 'ja' => '日本語', 'zh' => '中文', 'ar' => 'العربية',
                ];
                ?>
                <div class="dg-wizard" style="margin-top:20px;">
                    <div class="dg-wizard-header">
                        <h2><?php esc_html_e('Sprachumschalter', 'deepglot'); ?></h2>
                        <p><?php esc_html_e('Wie und wo soll der Language-Switcher auf deiner Website erscheinen?', 'deepglot'); ?></p>
                    </div>

                    <div class="dg-toggle-row">
                        <input
                            type="checkbox"
                            id="dg_switcher_auto_inject"
                            name="<?php echo esc_attr($optKey); ?>[switcher_auto_inject]"
                            value="1"
                            class="dg-toggle"
                            <?php checked(!empty($settings['switcher_auto_inject'])); ?>
                        />
                        <label for="dg_switcher_auto_inject">
                            <?php esc_html_e('Switcher automatisch im Seitenfooter einfügen', 'deepglot'); ?>
                        </label>
                    </div>
                    <p class="description" style="margin-top:4px;">
                        <?php esc_html_e('Alternativ: Shortcode [deepglot_switcher] oder PHP do_action(\'deepglot_language_switcher\') in deinem Theme.', 'deepglot'); ?>
                    </p>

                    <div class="dg-section-grid" style="margin-top:18px;">
                        <div class="dg-field">
                            <label for="dg_switcher_style"><?php esc_html_e('Darstellung', 'deepglot'); ?></label>
                            <select id="dg_switcher_style" name="<?php echo esc_attr($optKey); ?>[switcher_default_style]">
                                <option value="list" <?php selected(($settings['switcher_default_style'] ?? 'list'), 'list'); ?>>
                                    <?php esc_html_e('Inline-Liste', 'deepglot'); ?>
                                </option>
                                <option value="dropdown" <?php selected(($settings['switcher_default_style'] ?? 'list'), 'dropdown'); ?>>
                                    <?php esc_html_e('Dropdown', 'deepglot'); ?>
                                </option>
                            </select>
                        </div>

                        <div class="dg-field">
                            <label for="dg_switcher_flag"><?php esc_html_e('Flaggenstil', 'deepglot'); ?></label>
                            <select id="dg_switcher_flag" name="<?php echo esc_attr($optKey); ?>[switcher_flag_style]">
                                <option value="rectangle_mat" <?php selected(($settings['switcher_flag_style'] ?? 'rectangle_mat'), 'rectangle_mat'); ?>>
                                    <?php esc_html_e('Rechteckig, matt', 'deepglot'); ?>
                                </option>
                                <option value="rectangle_glossy" <?php selected(($settings['switcher_flag_style'] ?? 'rectangle_mat'), 'rectangle_glossy'); ?>>
                                    <?php esc_html_e('Rechteckig, glänzend', 'deepglot'); ?>
                                </option>
                                <option value="circle_mat" <?php selected(($settings['switcher_flag_style'] ?? 'rectangle_mat'), 'circle_mat'); ?>>
                                    <?php esc_html_e('Kreis, matt', 'deepglot'); ?>
                                </option>
                                <option value="circle_glossy" <?php selected(($settings['switcher_flag_style'] ?? 'rectangle_mat'), 'circle_glossy'); ?>>
                                    <?php esc_html_e('Kreis, glänzend', 'deepglot'); ?>
                                </option>
                                <option value="none" <?php selected(($settings['switcher_flag_style'] ?? 'rectangle_mat'), 'none'); ?>>
                                    <?php esc_html_e('Ohne Flagge', 'deepglot'); ?>
                                </option>
                            </select>
                        </div>

                        <div class="dg-field">
                            <label for="dg_switcher_label_format"><?php esc_html_e('Sprachbezeichnung', 'deepglot'); ?></label>
                            <select id="dg_switcher_label_format" name="<?php echo esc_attr($optKey); ?>[switcher_label_format]">
                                <option value="full_name" <?php selected(($settings['switcher_label_format'] ?? 'full_name'), 'full_name'); ?>>
                                    <?php esc_html_e('Volle Bezeichnung („Deutsch")', 'deepglot'); ?>
                                </option>
                                <option value="iso_code" <?php selected(($settings['switcher_label_format'] ?? 'full_name'), 'iso_code'); ?>>
                                    <?php esc_html_e('ISO-Code („DE")', 'deepglot'); ?>
                                </option>
                            </select>
                        </div>

                        <div class="dg-field">
                            <label for="dg_switcher_responsive"><?php esc_html_e('Anzeigegerät', 'deepglot'); ?></label>
                            <select id="dg_switcher_responsive" name="<?php echo esc_attr($optKey); ?>[switcher_responsive_hide]">
                                <option value="none" <?php selected(($settings['switcher_responsive_hide'] ?? 'none'), 'none'); ?>>
                                    <?php esc_html_e('Auf allen Geräten zeigen', 'deepglot'); ?>
                                </option>
                                <option value="mobile" <?php selected(($settings['switcher_responsive_hide'] ?? 'none'), 'mobile'); ?>>
                                    <?php esc_html_e('Nur Desktop (auf Mobile ausblenden)', 'deepglot'); ?>
                                </option>
                                <option value="desktop" <?php selected(($settings['switcher_responsive_hide'] ?? 'none'), 'desktop'); ?>>
                                    <?php esc_html_e('Nur Mobile (auf Desktop ausblenden)', 'deepglot'); ?>
                                </option>
                            </select>
                        </div>

                        <div class="dg-field">
                            <label for="dg_switcher_breakpoint"><?php esc_html_e('Mobile-Breakpoint (px)', 'deepglot'); ?></label>
                            <input
                                id="dg_switcher_breakpoint"
                                type="number"
                                min="320"
                                max="1920"
                                step="1"
                                name="<?php echo esc_attr($optKey); ?>[switcher_responsive_breakpoint]"
                                value="<?php echo esc_attr((string) ($settings['switcher_responsive_breakpoint'] ?? 768)); ?>"
                                style="width:120px; padding:8px 10px; border:1px solid #d1d5db; border-radius:6px; font-size:13px;"
                            />
                            <p class="description" style="margin-top:4px; font-size:12px;">
                                <?php esc_html_e('Standard 768 px. Unter dieser Breite gilt eine Seite als „Mobile".', 'deepglot'); ?>
                            </p>
                        </div>

                        <div class="dg-field">
                            <label for="dg_switcher_position"><?php esc_html_e('Position auf der Seite', 'deepglot'); ?></label>
                            <select id="dg_switcher_position" name="<?php echo esc_attr($optKey); ?>[switcher_position]">
                                <option value="inline" <?php selected(($settings['switcher_position'] ?? 'inline'), 'inline'); ?>>
                                    <?php esc_html_e('Inline (an der eingebetteten Stelle)', 'deepglot'); ?>
                                </option>
                                <option value="fixed-bottom-right" <?php selected(($settings['switcher_position'] ?? 'inline'), 'fixed-bottom-right'); ?>>
                                    <?php esc_html_e('Floating: rechts unten', 'deepglot'); ?>
                                </option>
                                <option value="fixed-bottom-left" <?php selected(($settings['switcher_position'] ?? 'inline'), 'fixed-bottom-left'); ?>>
                                    <?php esc_html_e('Floating: links unten', 'deepglot'); ?>
                                </option>
                                <option value="fixed-top-right" <?php selected(($settings['switcher_position'] ?? 'inline'), 'fixed-top-right'); ?>>
                                    <?php esc_html_e('Floating: rechts oben', 'deepglot'); ?>
                                </option>
                                <option value="fixed-top-left" <?php selected(($settings['switcher_position'] ?? 'inline'), 'fixed-top-left'); ?>>
                                    <?php esc_html_e('Floating: links oben', 'deepglot'); ?>
                                </option>
                            </select>
                            <p class="description" style="margin-top:4px; font-size:12px;">
                                <?php esc_html_e('„Floating" pinnt den Switcher mit position:fixed an die Ecke und scrollt mit. Kombiniert mit Auto-Inject = Weglot-Default-Verhalten.', 'deepglot'); ?>
                            </p>
                        </div>

                        <div class="dg-field" style="display:flex; align-items:flex-end;">
                            <div class="dg-toggle-row" style="margin-bottom:6px;">
                                <input
                                    type="checkbox"
                                    id="dg_switcher_show_label"
                                    name="<?php echo esc_attr($optKey); ?>[switcher_show_label]"
                                    value="1"
                                    class="dg-toggle"
                                    <?php checked(!empty($settings['switcher_show_label'])); ?>
                                />
                                <label for="dg_switcher_show_label">
                                    <?php esc_html_e('Bezeichnung sichtbar', 'deepglot'); ?>
                                </label>
                            </div>
                        </div>
                    </div>

                    <div class="dg-field" style="margin-top:18px;">
                        <label><?php esc_html_e('Reihenfolge der Sprachen', 'deepglot'); ?></label>
                        <ul id="dg-switcher-order" class="dg-sortable">
                            <?php foreach ($orderedLangs as $lang) :
                                $native = $nativeLabels[$lang] ?? '';
                            ?>
                                <li class="dg-sortable-item" draggable="true" data-lang="<?php echo esc_attr($lang); ?>">
                                    <span class="dg-drag-handle" aria-hidden="true">⠿</span>
                                    <span class="dg-sortable-label"><?php echo esc_html(strtoupper($lang)); ?></span>
                                    <?php if ($native !== '') : ?>
                                        <span class="dg-sortable-native"><?php echo esc_html($native); ?></span>
                                    <?php endif; ?>
                                    <input
                                        type="hidden"
                                        name="<?php echo esc_attr($optKey); ?>[switcher_language_order][]"
                                        value="<?php echo esc_attr($lang); ?>"
                                    >
                                </li>
                            <?php endforeach; ?>
                        </ul>
                        <p class="description"><?php esc_html_e('Per Drag-&-Drop neu anordnen. Greift sowohl im Shortcode als auch beim Auto-Inject.', 'deepglot'); ?></p>
                    </div>

                    <div class="dg-field" style="margin-top:18px;">
                        <label for="dg_switcher_custom_css"><?php esc_html_e('Eigenes CSS für den Switcher', 'deepglot'); ?></label>
                        <textarea
                            id="dg_switcher_custom_css"
                            name="<?php echo esc_attr($optKey); ?>[switcher_custom_css]"
                            rows="6"
                            style="width:100%; max-width:460px; font-family:monospace; font-size:12px;"
                            placeholder=".deepglot-switcher li a { color: #333; }"
                        ><?php echo esc_textarea((string) ($settings['switcher_custom_css'] ?? '')); ?></textarea>
                        <p class="description"><?php esc_html_e('Wird unmittelbar vor dem Switcher als <style>-Tag eingefügt. „<" wird automatisch entfernt, damit kein Script-Tag eingeschleust werden kann.', 'deepglot'); ?></p>
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

            <script>
            (function () {
                var list = document.getElementById('dg-switcher-order');
                if (!list) return;
                var dragging = null;

                list.addEventListener('dragstart', function (event) {
                    var item = event.target.closest('.dg-sortable-item');
                    if (!item || !list.contains(item)) return;
                    dragging = item;
                    item.classList.add('dragging');
                    event.dataTransfer.effectAllowed = 'move';
                    // Firefox needs payload on dataTransfer for dragstart to fire.
                    try { event.dataTransfer.setData('text/plain', item.dataset.lang || ''); } catch (e) {}
                });

                list.addEventListener('dragend', function () {
                    if (dragging) dragging.classList.remove('dragging');
                    list.querySelectorAll('.drag-over').forEach(function (el) {
                        el.classList.remove('drag-over');
                    });
                    dragging = null;
                });

                list.addEventListener('dragover', function (event) {
                    event.preventDefault();
                    if (!dragging) return;
                    var target = event.target.closest('.dg-sortable-item');
                    if (!target || target === dragging || !list.contains(target)) return;

                    list.querySelectorAll('.drag-over').forEach(function (el) {
                        el.classList.remove('drag-over');
                    });
                    target.classList.add('drag-over');

                    var rect = target.getBoundingClientRect();
                    var midY = rect.top + rect.height / 2;
                    if (event.clientY < midY) {
                        list.insertBefore(dragging, target);
                    } else {
                        list.insertBefore(dragging, target.nextSibling);
                    }
                });

                list.addEventListener('drop', function (event) {
                    event.preventDefault();
                });
            })();
            </script>
        </div>
        <?php
    }
}
