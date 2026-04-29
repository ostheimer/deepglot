<?php

if (!function_exists('__')) {
    function __($text, $domain = null) {
        return $text;
    }
}

if (!function_exists('get_option')) {
    $GLOBALS['_deepglot_options'] = [];

    function get_option($key, $default = false) {
        return $GLOBALS['_deepglot_options'][$key] ?? $default;
    }

    function update_option($key, $value) {
        $GLOBALS['_deepglot_options'][$key] = $value;
        return true;
    }

    function wp_parse_args($args, $defaults = []) {
        return array_merge($defaults, is_array($args) ? $args : []);
    }

    function sanitize_text_field($value) {
        return trim((string) $value);
    }

    function sanitize_textarea_field($value) {
        return trim((string) $value);
    }

    function esc_url_raw($value) {
        return (string) $value;
    }

    function untrailingslashit($value) {
        return rtrim((string) $value, '/');
    }

    function is_wp_error($value) {
        return $value instanceof WP_Error;
    }

    class WP_Error
    {
    }
}

require_once __DIR__ . '/../includes/Config/Options.php';
require_once __DIR__ . '/../includes/Api/Client.php';
require_once __DIR__ . '/../includes/Support/TranslationCache.php';
require_once __DIR__ . '/../includes/Support/UrlLanguageResolver.php';
require_once __DIR__ . '/../includes/Support/SiteRouting.php';
require_once __DIR__ . '/../includes/Frontend/HtmlTranslator.php';
require_once __DIR__ . '/../includes/Frontend/WooCommerceEmailTranslator.php';

use Deepglot\Api\Client;
use Deepglot\Config\Options;
use Deepglot\Frontend\HtmlTranslator;
use Deepglot\Frontend\WooCommerceEmailTranslator;
use Deepglot\Support\SiteRouting;
use Deepglot\Support\UrlLanguageResolver;

function assertSameWoo($expected, $actual, string $message): void
{
    if ($expected !== $actual) {
        fwrite(STDERR, $message . PHP_EOL);
        fwrite(STDERR, 'Expected: ' . var_export($expected, true) . PHP_EOL);
        fwrite(STDERR, 'Actual:   ' . var_export($actual, true) . PHP_EOL);
        exit(1);
    }
}

class DeepglotWooFakeClient extends Client
{
    public array $calls = [];

    public function __construct()
    {
    }

    public function translate(array $texts, string $langFrom, string $langTo, string $requestUrl = '')
    {
        $this->calls[] = compact('texts', 'langFrom', 'langTo', 'requestUrl');

        return [
            'from_words' => $texts,
            'to_words' => array_map(static fn($text) => '[' . $langTo . '] ' . $text, $texts),
        ];
    }
}

class DeepglotWooFakeHtmlTranslator extends HtmlTranslator
{
    public array $calls = [];

    public function __construct()
    {
    }

    public function translate(string $html, string $targetLanguage): string
    {
        $this->calls[] = [
            'html' => $html,
            'targetLanguage' => $targetLanguage,
        ];

        return '<translated lang="' . $targetLanguage . '">' . $html . '</translated>';
    }
}

class DeepglotWooFakeOrder
{
    public array $meta = [];

    public function __construct(array $meta = [])
    {
        $this->meta = $meta;
    }

    public function update_meta_data($key, $value): void
    {
        $this->meta[$key] = $value;
    }

    public function get_meta($key)
    {
        return $this->meta[$key] ?? '';
    }
}

class DeepglotWooFakeEmail
{
    public $object;
    public bool $plain_text;

    public function __construct($object, bool $plainText)
    {
        $this->object = $object;
        $this->plain_text = $plainText;
    }
}

function deepglotWooTranslator(
    Options $options,
    SiteRouting $routing,
    DeepglotWooFakeClient $client,
    DeepglotWooFakeHtmlTranslator $htmlTranslator
): WooCommerceEmailTranslator {
    return new WooCommerceEmailTranslator($options, $routing, $client, $htmlTranslator);
}

function deepglotWooEnableOptions(bool $translateEmails = true): Options
{
    $options = new Options();

    update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
        'enabled' => true,
        'api_key' => 'dg_test_key',
        'source_language' => 'de',
        'target_languages' => ['en', 'fr'],
        'translate_emails' => $translateEmails,
    ]));

    return $options;
}

$routing = new SiteRouting(
    new UrlLanguageResolver('de', ['en', 'fr']),
    'https://example.com',
    'SUBDOMAIN',
    [
        'en' => 'en.example.com',
        'fr' => 'fr.example.com',
    ]
);

$client = new DeepglotWooFakeClient();
$htmlTranslator = new DeepglotWooFakeHtmlTranslator();
$translator = deepglotWooTranslator(deepglotWooEnableOptions(), $routing, $client, $htmlTranslator);

$_SERVER['REQUEST_URI'] = '/checkout/';
$_SERVER['HTTP_HOST'] = 'en.example.com';

$order = new DeepglotWooFakeOrder();
$translator->storeCheckoutLanguage($order, []);

assertSameWoo('en', $order->get_meta('_deepglot_checkout_language'), 'Checkout language should be persisted from the localized subdomain host.');

$htmlEmail = new DeepglotWooFakeEmail($order, false);
$translator->captureEmailContext('Ihre Bestellung', $htmlEmail);

assertSameWoo(
    '<translated lang="en"><p>Ihre Bestellung wurde empfangen.</p></translated>',
    $translator->translateMailContent('<p>Ihre Bestellung wurde empfangen.</p>'),
    'HTML WooCommerce email content should use the stored checkout language.'
);
assertSameWoo('en', $htmlTranslator->calls[0]['targetLanguage'] ?? null, 'HTML email translation should be called with the stored target language.');

assertSameWoo(
    '[en] Ihre Bestellung',
    $translator->translateEmailSubject('Ihre Bestellung', $order),
    'WooCommerce email subjects should be translated as plain text.'
);
assertSameWoo(
    '[en] Danke für Ihren Einkauf',
    $translator->translateEmailHeading('Danke für Ihren Einkauf', $order),
    'WooCommerce email headings should be translated as plain text.'
);
assertSameWoo('de', $client->calls[0]['langFrom'] ?? null, 'Plain-text email translation should use the configured source language.');
assertSameWoo('en', $client->calls[0]['langTo'] ?? null, 'Plain-text email translation should use the stored target language.');

$translator->clearEmailContext($htmlEmail);
$htmlTranslator->calls = [];

$plainTextEmail = new DeepglotWooFakeEmail($order, true);
$translator->captureEmailContext('Ihre Bestellung', $plainTextEmail);

assertSameWoo(
    'Ihre Bestellung wurde empfangen.',
    $translator->translateMailContent('Ihre Bestellung wurde empfangen.'),
    'Plain-text WooCommerce email bodies should be skipped in v1.'
);
assertSameWoo([], $htmlTranslator->calls, 'Plain-text email bodies should not call the HTML translator.');

$unsupportedOrder = new DeepglotWooFakeOrder(['_deepglot_checkout_language' => 'it']);

assertSameWoo(
    'Ihre Bestellung',
    $translator->translateEmailSubject('Ihre Bestellung', $unsupportedOrder),
    'Unsupported stored checkout languages should fall back to the source language and skip translation.'
);

$disabledClient = new DeepglotWooFakeClient();
$disabledHtmlTranslator = new DeepglotWooFakeHtmlTranslator();
$disabledTranslator = deepglotWooTranslator(deepglotWooEnableOptions(false), $routing, $disabledClient, $disabledHtmlTranslator);
$disabledOrder = new DeepglotWooFakeOrder();

$disabledTranslator->storeCheckoutLanguage($disabledOrder, []);

assertSameWoo('', $disabledOrder->get_meta('_deepglot_checkout_language'), 'Disabled email translation should not persist checkout language metadata.');
assertSameWoo('Betreff', $disabledTranslator->translateEmailSubject('Betreff', $order), 'Disabled email translation should leave subjects unchanged.');

fwrite(STDOUT, "WooCommerceEmailTranslatorTest: OK\n");
