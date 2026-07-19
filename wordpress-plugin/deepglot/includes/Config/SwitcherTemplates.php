<?php

namespace Deepglot\Config;

/**
 * Versioned, immutable source definitions for one-click switcher designs.
 * Applying a template returns a plain editable instance configuration; later
 * registry changes therefore never rewrite an existing site's appearance.
 */
final class SwitcherTemplates
{
    public const VERSION = 1;

    /**
     * @return array<string,array{name:string,description:string,config:array<string,mixed>}>
     */
    public static function registry(): array
    {
        return [
            'classic-dropdown' => [
                'name' => __('Klassisches Dropdown', 'deepglot'),
                'description' => __('Flagge und vollständiger Sprachname in einem kompakten Dropdown.', 'deepglot'),
                'config' => self::baseConfig([
                    'style' => 'dropdown',
                    'flag_style' => 'rectangle_mat',
                    'show_label' => true,
                    'label_format' => 'full_name',
                ]),
            ],
            'minimal-code' => [
                'name' => __('Minimaler Sprachcode', 'deepglot'),
                'description' => __('Schlichte ISO-Codes ohne Flaggen für Navigationen mit wenig Platz.', 'deepglot'),
                'config' => self::baseConfig([
                    'style' => 'list',
                    'flag_style' => 'none',
                    'show_label' => true,
                    'label_format' => 'iso_code',
                ]),
            ],
            'floating-flags' => [
                'name' => __('Schwebende Flaggen', 'deepglot'),
                'description' => __('Runde Flaggen als schwebender Umschalter unten rechts.', 'deepglot'),
                'config' => self::baseConfig([
                    'style' => 'dropdown',
                    'flag_style' => 'circle_glossy',
                    'show_label' => false,
                    'label_format' => 'full_name',
                    'position' => 'fixed-bottom-right',
                ]),
            ],
        ];
    }

    /**
     * @return array<string,mixed>
     */
    public static function createInstance(string $templateId, string $instanceId, string $name): array
    {
        $registry = self::registry();
        if (!isset($registry[$templateId])) {
            $templateId = 'classic-dropdown';
        }

        $id = self::sanitizeId($instanceId);
        if ($id === '') {
            $id = 'switcher-' . substr(sha1($name . microtime()), 0, 8);
        }

        return array_merge($registry[$templateId]['config'], [
            'id' => $id,
            'name' => self::sanitizeName($name),
            'template' => $templateId,
            'template_version' => self::VERSION,
        ]);
    }

    /**
     * @param array<string,mixed> $overrides
     * @return array<string,mixed>
     */
    private static function baseConfig(array $overrides): array
    {
        return array_merge([
            'enabled' => true,
            'auto_inject' => false,
            'style' => 'list',
            'flag_style' => 'rectangle_mat',
            'show_label' => true,
            'label_format' => 'full_name',
            'language_order' => [],
            'custom_css' => '',
            'position' => 'inline',
            'responsive_hide' => 'none',
            'responsive_breakpoint' => Options::SWITCHER_BREAKPOINT_DEFAULT,
            'custom_flags' => [],
            'selector' => '',
        ], $overrides);
    }

    private static function sanitizeId(string $value): string
    {
        if (function_exists('sanitize_key')) {
            return substr(sanitize_key($value), 0, 64);
        }

        return substr(trim(strtolower((string) preg_replace('/[^a-z0-9_-]/i', '', $value)), '_-'), 0, 64);
    }

    private static function sanitizeName(string $value): string
    {
        $value = function_exists('sanitize_text_field')
            ? sanitize_text_field($value)
            // phpcs:ignore WordPress.WP.AlternativeFunctions.strip_tags_strip_tags -- fallback for the non-WordPress unit-test context only; WordPress always takes the sanitize_text_field() branch.
            : trim(strip_tags($value));

        return $value !== '' ? $value : __('Sprachumschalter', 'deepglot');
    }
}
