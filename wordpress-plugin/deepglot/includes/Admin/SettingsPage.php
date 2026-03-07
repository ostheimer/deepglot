<?php

namespace Deepglot\Admin;

use Deepglot\Config\Options;

class SettingsPage
{
    private Options $options;

    public function __construct(Options $options)
    {
        $this->options = $options;
    }

    public function register(): void
    {
        add_action('admin_menu', [$this, 'registerMenu']);
        add_action('admin_init', [$this, 'registerSettings']);
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

    public function render(): void
    {
        if (!current_user_can('manage_options')) {
            return;
        }

        $settings = $this->options->all();
        ?>
        <div class="wrap">
            <h1><?php echo esc_html__('Deepglot Einstellungen', 'deepglot'); ?></h1>
            <p><?php echo esc_html__('Konfiguriere die Verbindung zum Deepglot-Backend und das Sprachrouting fuer dein WordPress-Projekt.', 'deepglot'); ?></p>

            <form method="post" action="options.php">
                <?php settings_fields('deepglot'); ?>

                <table class="form-table" role="presentation">
                    <tbody>
                        <tr>
                            <th scope="row"><?php echo esc_html__('Uebersetzung aktivieren', 'deepglot'); ?></th>
                            <td>
                                <label>
                                    <input type="checkbox" name="<?php echo esc_attr(Options::OPTION_KEY); ?>[enabled]" value="1" <?php checked(!empty($settings['enabled'])); ?> />
                                    <?php echo esc_html__('Deepglot fuer Frontend-Anfragen aktivieren', 'deepglot'); ?>
                                </label>
                            </td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="deepglot_api_base_url"><?php echo esc_html__('API-Basis-URL', 'deepglot'); ?></label></th>
                            <td>
                                <input id="deepglot_api_base_url" name="<?php echo esc_attr(Options::OPTION_KEY); ?>[api_base_url]" type="url" class="regular-text code" value="<?php echo esc_attr($settings['api_base_url']); ?>" />
                                <p class="description"><?php echo esc_html__('Beispiel: https://deepglot-five.vercel.app/api', 'deepglot'); ?></p>
                            </td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="deepglot_api_key"><?php echo esc_html__('API-Key', 'deepglot'); ?></label></th>
                            <td>
                                <input id="deepglot_api_key" name="<?php echo esc_attr(Options::OPTION_KEY); ?>[api_key]" type="text" class="regular-text code" value="<?php echo esc_attr($settings['api_key']); ?>" />
                                <p class="description"><?php echo esc_html__('Verwende einen aktiven Projekt-API-Key aus dem Deepglot-Dashboard.', 'deepglot'); ?></p>
                            </td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="deepglot_source_language"><?php echo esc_html__('Ausgangssprache', 'deepglot'); ?></label></th>
                            <td>
                                <input id="deepglot_source_language" name="<?php echo esc_attr(Options::OPTION_KEY); ?>[source_language]" type="text" class="small-text" value="<?php echo esc_attr($settings['source_language']); ?>" />
                            </td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="deepglot_target_languages"><?php echo esc_html__('Zielsprachen', 'deepglot'); ?></label></th>
                            <td>
                                <input id="deepglot_target_languages" name="<?php echo esc_attr(Options::OPTION_KEY); ?>[target_languages]" type="text" class="regular-text" value="<?php echo esc_attr(implode(', ', (array) $settings['target_languages'])); ?>" />
                                <p class="description"><?php echo esc_html__('Kommagetrennte ISO-Codes, z. B. en, fr, it', 'deepglot'); ?></p>
                            </td>
                        </tr>
                        <tr>
                            <th scope="row"><?php echo esc_html__('Auto-Weiterleitung', 'deepglot'); ?></th>
                            <td>
                                <label>
                                    <input type="checkbox" name="<?php echo esc_attr(Options::OPTION_KEY); ?>[auto_redirect]" value="1" <?php checked(!empty($settings['auto_redirect'])); ?> />
                                    <?php echo esc_html__('Besucher optional anhand der Browsersprache weiterleiten', 'deepglot'); ?>
                                </label>
                            </td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="deepglot_exclude_urls"><?php echo esc_html__('Ausgeschlossene URLs', 'deepglot'); ?></label></th>
                            <td>
                                <textarea id="deepglot_exclude_urls" name="<?php echo esc_attr(Options::OPTION_KEY); ?>[exclude_urls]" rows="5" class="large-text code"><?php echo esc_textarea($settings['exclude_urls']); ?></textarea>
                                <p class="description"><?php echo esc_html__('Eine URL oder ein Muster pro Zeile.', 'deepglot'); ?></p>
                            </td>
                        </tr>
                        <tr>
                            <th scope="row"><label for="deepglot_exclude_selectors"><?php echo esc_html__('Ausgeschlossene CSS-Selektoren', 'deepglot'); ?></label></th>
                            <td>
                                <textarea id="deepglot_exclude_selectors" name="<?php echo esc_attr(Options::OPTION_KEY); ?>[exclude_selectors]" rows="5" class="large-text code"><?php echo esc_textarea($settings['exclude_selectors']); ?></textarea>
                                <p class="description"><?php echo esc_html__('Eine CSS-Klasse, ID oder ein Selektor pro Zeile.', 'deepglot'); ?></p>
                            </td>
                        </tr>
                    </tbody>
                </table>

                <?php submit_button(__('Einstellungen speichern', 'deepglot')); ?>
            </form>
        </div>
        <?php
    }
}
