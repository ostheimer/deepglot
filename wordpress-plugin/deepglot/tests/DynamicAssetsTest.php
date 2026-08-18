<?php

namespace Deepglot\Api {
    class RestApi
    {
        public const NAMESPACE = 'deepglot/v1';
    }
}

namespace Deepglot\Frontend {
    class DynamicTranslationController
    {
        public const ROUTE = '/translate-dynamic';

        public static function issueQuotaTicket(): string
        {
            return 'test-quota-ticket';
        }
    }
}

namespace {
    function dynamicAssetsAssert(bool $condition, string $message): void
    {
        if (!$condition) {
            fwrite(STDERR, '✗ ' . $message . PHP_EOL);
            exit(1);
        }
    }

    if (!defined('ABSPATH')) {
        define('ABSPATH', __DIR__ . '/');
    }
    if (!defined('DEEPGLOT_PLUGIN_URL')) {
        define('DEEPGLOT_PLUGIN_URL', 'https://example.com/wp-content/plugins/deepglot/');
    }
    if (!defined('DEEPGLOT_PLUGIN_VERSION')) {
        define('DEEPGLOT_PLUGIN_VERSION', 'test');
    }

    $GLOBALS['_deepglot_dynamic_assets_options'] = [];
    $GLOBALS['_deepglot_dynamic_assets_localized'] = [];

    function get_option($key, $default = false)
    {
        return $GLOBALS['_deepglot_dynamic_assets_options'][$key] ?? $default;
    }

    function update_option($key, $value): bool
    {
        $GLOBALS['_deepglot_dynamic_assets_options'][$key] = $value;

        return true;
    }

    function wp_parse_args($args, $defaults = []): array
    {
        return array_merge($defaults, is_array($args) ? $args : []);
    }

    function esc_url_raw($value): string { return (string) $value; }
    if (!function_exists('wp_unslash')) {
        function wp_unslash($value) { return $value; }
    }
    function sanitize_text_field($value): string { return trim((string) $value); }
    function untrailingslashit($value): string { return rtrim((string) $value, '/'); }
    function home_url($path = '/'): string { return 'https://example.com' . $path; }
    function rest_url($path = ''): string { return 'https://example.com/wp-json/' . ltrim((string) $path, '/'); }
    function wp_make_link_relative($url): string { return (string) parse_url((string) $url, PHP_URL_PATH); }
    function wp_create_nonce($action): string { return 'test-nonce'; }
    function wp_register_script(...$args): bool { return true; }
    function wp_enqueue_script(...$args): bool { return true; }

    function wp_localize_script($handle, $objectName, $data): bool
    {
        $GLOBALS['_deepglot_dynamic_assets_localized'] = [$handle, $objectName, $data];

        return true;
    }

    require_once __DIR__ . '/../includes/Config/Options.php';
    require_once __DIR__ . '/../includes/Support/TranslationRules.php';
    require_once __DIR__ . '/../includes/Support/UrlLanguageResolver.php';
    require_once __DIR__ . '/../includes/Support/SiteRouting.php';
    require_once __DIR__ . '/../includes/Frontend/DynamicAssets.php';

    use Deepglot\Config\Options;
    use Deepglot\Frontend\DynamicAssets;
    use Deepglot\Support\SiteRouting;
    use Deepglot\Support\UrlLanguageResolver;

    $GLOBALS['_deepglot_dynamic_assets_options'][Options::OPTION_KEY] = array_merge(Options::defaults(), [
        'enabled' => true,
        'api_key' => 'dg_test_key',
        'source_language' => 'de',
        'target_languages' => ['en'],
        'enable_dynamic_translation' => true,
    ]);
    $_SERVER['REQUEST_URI'] = '/en/';
    $_SERVER['HTTP_HOST'] = 'example.com';

    $assets = new DynamicAssets(
        new Options(),
        new SiteRouting(new UrlLanguageResolver('de', ['en']), 'https://example.com', 'PATH_PREFIX', [])
    );
    $assets->enqueue();

    $config = $GLOBALS['_deepglot_dynamic_assets_localized'][2] ?? [];
    dynamicAssetsAssert(
        ($config['initialDynamicSelectors'] ?? null) === ['.cc-window[data-nosnippet="true"]'],
        'Dynamic assets must configure the narrow Cookie-Consent root for the one-time initial scan.'
    );

    fwrite(STDOUT, "DynamicAssetsTest: OK\n");
}
