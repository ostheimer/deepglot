<?php

/**
 * Guards the single-source-of-truth contract for text-extraction rules.
 *
 * TranslationRules ships SKIP_TAGS to the browser (dynamic pass); HtmlTranslator
 * uses its own private SKIP_TAGS for the server pass. They MUST stay identical
 * or the two passes will disagree on what is translatable. This test fails the
 * moment one list drifts from the other, plus it pins isTranslatableText().
 */

if (!function_exists('__')) {
    function __($text, $domain = null) {
        return $text;
    }

    $GLOBALS['_deepglot_options'] = [];

    function get_option($key, $default = false) {
        return $GLOBALS['_deepglot_options'][$key] ?? $default;
    }

    function update_option($key, $value) {
        $GLOBALS['_deepglot_options'][$key] = $value;
        return true;
    }

    function get_transient($key) {
        return false;
    }

    function set_transient($key, $value, $ttl = 0) {
        return true;
    }

    function is_wp_error($value) {
        return false;
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

    if (!defined('DAY_IN_SECONDS')) {
        define('DAY_IN_SECONDS', 86400);
    }
}

require_once __DIR__ . '/../includes/Config/Options.php';
require_once __DIR__ . '/../includes/Api/Client.php';
require_once __DIR__ . '/../includes/Support/TranslationCache.php';
require_once __DIR__ . '/../includes/Support/TranslationRules.php';
require_once __DIR__ . '/../includes/Frontend/JsonLdTranslator.php';
require_once __DIR__ . '/../includes/Support/BotDetector.php';
require_once __DIR__ . '/../includes/Support/HtmlDocument.php';
require_once __DIR__ . '/../includes/Frontend/HtmlTranslator.php';

use Deepglot\Frontend\HtmlTranslator;
use Deepglot\Support\TranslationRules;

function rulesCheck($condition, string $message): void
{
    if ($condition !== true) {
        fwrite(STDERR, 'FAIL: ' . $message . PHP_EOL);
        exit(1);
    }
}

// SKIP_TAGS must match the server pass exactly (private const read via reflection).
$serverConstants = (new ReflectionClass(HtmlTranslator::class))->getConstants();
rulesCheck(
    isset($serverConstants['SKIP_TAGS']),
    'HtmlTranslator::SKIP_TAGS must exist for the drift guard.'
);
rulesCheck(
    $serverConstants['SKIP_TAGS'] === TranslationRules::SKIP_TAGS,
    'TranslationRules::SKIP_TAGS has drifted from HtmlTranslator::SKIP_TAGS — keep them identical.'
);
rulesCheck(
    isset($serverConstants['TRANSLATABLE_BODY_ATTRIBUTES'])
        && $serverConstants['TRANSLATABLE_BODY_ATTRIBUTES'] === TranslationRules::TRANSLATABLE_BODY_ATTRIBUTES,
    'TranslationRules::TRANSLATABLE_BODY_ATTRIBUTES has drifted from HtmlTranslator — keep them identical.'
);
rulesCheck(
    isset($serverConstants['TRANSLATABLE_INPUT_VALUE_TYPES'])
        && $serverConstants['TRANSLATABLE_INPUT_VALUE_TYPES'] === TranslationRules::TRANSLATABLE_INPUT_VALUE_TYPES,
    'TranslationRules::TRANSLATABLE_INPUT_VALUE_TYPES has drifted from HtmlTranslator — keep them identical.'
);
rulesCheck(
    isset($serverConstants['ATTR_SKIP_ANCESTORS'])
        && $serverConstants['ATTR_SKIP_ANCESTORS'] === TranslationRules::ATTR_SKIP_ANCESTORS,
    'TranslationRules::ATTR_SKIP_ANCESTORS has drifted from HtmlTranslator — keep them identical.'
);

// isTranslatableText: long enough and not purely numeric/punctuation.
rulesCheck(TranslationRules::isTranslatableText('Hallo') === true, '"Hallo" should be translatable.');
rulesCheck(TranslationRules::isTranslatableText('Hi') === true, 'A 2-char word should be translatable.');
rulesCheck(TranslationRules::isTranslatableText('a') === false, 'A single character is below the minimum length.');
rulesCheck(TranslationRules::isTranslatableText('') === false, 'Empty string is not translatable.');
rulesCheck(TranslationRules::isTranslatableText('12') === false, 'Pure digits are not translatable.');
rulesCheck(TranslationRules::isTranslatableText('—  .') === false, 'Punctuation-only text is not translatable.');
rulesCheck(TranslationRules::isTranslatableText('€49') === false, 'Currency symbol + digits carry no translatable copy.');
rulesCheck(TranslationRules::isTranslatableText('Nur 49 €') === true, 'Copy with real words stays translatable.');

fwrite(STDOUT, "TranslationRulesTest: OK\n");
