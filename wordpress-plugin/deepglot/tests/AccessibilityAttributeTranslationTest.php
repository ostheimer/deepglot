<?php

/**
 * Reproduces the leftover-German strings in `<img alt="…">` observed on
 * https://www.meinhaushalt.at/en/ on 2026-05-11. The "Currently on Mein
 * Haushalt" widget renders the article cover image with the post title
 * inside the alt attribute, and the plugin previously translated only
 * text nodes plus a small whitelist of `<meta>` content attributes, so
 * accessibility-relevant alt text stayed in the source language.
 *
 * The translator must also translate user-facing copy carried in:
 *   - <img alt="…">
 *   - <a title="…">
 *   - <button title="…">
 *   - <input placeholder="…">
 *   - <textarea placeholder="…">
 *   - <input value="…" type="submit|button|reset"> (button copy)
 *   - <any aria-label="…">
 *
 * but must NOT translate:
 *   - alt / title on tags that carry machine identifiers (e.g. <link>)
 *   - empty / whitespace-only / single-character values
 *   - any attribute inside <head><script>, <style>, <noscript>, …
 *
 * Run standalone: php tests/AccessibilityAttributeTranslationTest.php
 */

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

    function wp_json_encode($data, $options = 0, $depth = 512) {
        return json_encode($data, $options, $depth);
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
require_once __DIR__ . '/../includes/Frontend/JsonLdTranslator.php';
require_once __DIR__ . '/../includes/Frontend/HtmlTranslator.php';

use Deepglot\Api\Client;
use Deepglot\Config\Options;
use Deepglot\Frontend\HtmlTranslator;
use Deepglot\Support\TranslationCache;

class DeepglotA11yFakeClient extends Client
{
    public array $sentTexts = [];

    public function __construct() {}

    public function translate(array $texts, string $langFrom, string $langTo, string $requestUrl = '', int $bot = 0)
    {
        foreach ($texts as $text) {
            $this->sentTexts[] = $text;
        }

        return [
            'from_words' => $texts,
            'to_words' => array_map(static fn(string $text) => '[en] ' . $text, $texts),
        ];
    }
}

class DeepglotA11yNullCache extends TranslationCache
{
    public function getMany(array $texts, string $from, string $to): array
    {
        return [];
    }

    public function setMany(array $translations, string $from, string $to): void {}
}

function a11yAssert(bool $condition, string $message): void
{
    if (!$condition) {
        fwrite(STDERR, '✗ ' . $message . PHP_EOL);
        exit(1);
    }
}

$options = new Options();
update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
    'enabled' => true,
    'api_key' => 'dg_test_key',
    'source_language' => 'de',
    'target_languages' => ['en'],
]));

$client = new DeepglotA11yFakeClient();
$translator = new HtmlTranslator($client, $options, new DeepglotA11yNullCache());

$html = '<!DOCTYPE html><html><head>'
    . '<title>Test</title>'
    . '<link rel="canonical" href="https://example.com/" title="Should not translate">'
    . '</head>'
    . '<body>'
    . '<img alt="Online einkaufen leicht gemacht: Erfahrungsbericht" src="/img/cover.jpg">'
    . '<img alt="" src="/img/spacer.gif">'
    . '<img alt="x" src="/img/short.gif">'
    . '<img alt="   " src="/img/whitespace.gif">'
    . '<a href="/blog/" title="Mehr über das Bloggen">Blog Link</a>'
    . '<a href="/x/" aria-label="Suche öffnen"><span aria-hidden="true">🔍</span></a>'
    . '<button title="Neuen Beitrag erstellen" aria-label="Beitrag hinzufügen">+</button>'
    . '<input type="text" placeholder="Suche nach Rezepten">'
    . '<input type="email" placeholder="E-Mail eingeben">'
    . '<textarea placeholder="Hinterlasse einen Kommentar"></textarea>'
    . '<input type="submit" value="Abschicken">'
    . '<input type="hidden" value="should-not-translate">'
    . '<input type="text" value="Vorausgefüllter Wert">'
    . '<noscript><img alt="Sollte nicht uebersetzt werden" src="/no.gif"></noscript>'
    . '<h1>Hauptüberschrift</h1>'
    . '</body></html>';

$translated = $translator->translate($html, 'en');
$decoded = html_entity_decode($translated, ENT_QUOTES | ENT_HTML5, 'UTF-8');

// 1. <img alt> on body images IS sent for translation and applied back.
a11yAssert(in_array('Online einkaufen leicht gemacht: Erfahrungsbericht', $client->sentTexts, true), 'Long img alt must be sent for translation');
a11yAssert(str_contains($decoded, 'alt="[en] Online einkaufen leicht gemacht: Erfahrungsbericht"'), 'Img alt should be rewritten with translation: ' . substr($decoded, 0, 600));

// 2. Empty / single-character / whitespace-only alt values are NOT sent.
a11yAssert(!in_array('', $client->sentTexts, true), 'Empty alt must not be sent');
a11yAssert(!in_array('x', $client->sentTexts, true), 'Single-character alt must not be sent');
a11yAssert(!in_array('   ', $client->sentTexts, true), 'Whitespace-only alt must not be sent');

// 3. <a title> and aria-label are translated.
a11yAssert(in_array('Mehr über das Bloggen', $client->sentTexts, true), '<a title> must be sent');
a11yAssert(in_array('Suche öffnen', $client->sentTexts, true), '<a aria-label> must be sent');
a11yAssert(str_contains($decoded, 'title="[en] Mehr über das Bloggen"'), 'Translated <a title> should be rewritten');
a11yAssert(str_contains($decoded, 'aria-label="[en] Suche öffnen"'), 'Translated <a aria-label> should be rewritten');

// 4. <button title> and aria-label both translate (deduped if equal, kept separate if different).
a11yAssert(in_array('Neuen Beitrag erstellen', $client->sentTexts, true), '<button title> must be sent');
a11yAssert(in_array('Beitrag hinzufügen', $client->sentTexts, true), '<button aria-label> must be sent');

// 5. <input placeholder> and <textarea placeholder> translate.
a11yAssert(in_array('Suche nach Rezepten', $client->sentTexts, true), 'Input placeholder must be sent');
a11yAssert(in_array('E-Mail eingeben', $client->sentTexts, true), 'Email input placeholder must be sent');
a11yAssert(in_array('Hinterlasse einen Kommentar', $client->sentTexts, true), 'Textarea placeholder must be sent');
a11yAssert(str_contains($decoded, 'placeholder="[en] Suche nach Rezepten"'), 'Translated placeholder should be rewritten');

// 6. <input type="submit|button|reset" value> translates as a button label.
a11yAssert(in_array('Abschicken', $client->sentTexts, true), 'Submit button value must be sent');

// 7. <input type="hidden"> and <input type="text"> value attributes are NOT translated.
a11yAssert(!in_array('should-not-translate', $client->sentTexts, true), 'Hidden input value must not be sent');
a11yAssert(!in_array('Vorausgefüllter Wert', $client->sentTexts, true), 'Text input value must not be sent (pre-filled data, not UI copy)');

// 8. <link rel=canonical title> is NOT touched (machine metadata, not user copy).
a11yAssert(!in_array('Should not translate', $client->sentTexts, true), '<link title> must not be sent');

// 9. <noscript> children stay untouched.
a11yAssert(!in_array('Sollte nicht uebersetzt werden', $client->sentTexts, true), '<noscript> img alt must not be sent');

// 10. Body H1 still translates as before.
a11yAssert(in_array('Hauptüberschrift', $client->sentTexts, true), 'Body H1 still translates');
a11yAssert(str_contains($decoded, '[en] Hauptüberschrift'), 'H1 translation applied');

// 11. translate="no" on the element itself (not just an ancestor) must opt
// out — mirrors the ancestor-or-self semantics that text nodes already
// use so a single `<img translate="no" alt="…">` stays untranslated.
$selfClient = new DeepglotA11yFakeClient();
$selfTranslator = new HtmlTranslator($selfClient, $options, new DeepglotA11yNullCache());
$selfHtml = '<!DOCTYPE html><html><head></head><body>'
    . '<img translate="no" alt="Eigenname stays german" src="/x.jpg">'
    . '<a href="/x" translate="no" title="Auch nicht übersetzen">link</a>'
    . '<button translate="no" aria-label="Button-aria">Push</button>'
    . '<img alt="Normales Bildtitel" src="/y.jpg">'
    . '</body></html>';
$selfTranslator->translate($selfHtml, 'en');
a11yAssert(!in_array('Eigenname stays german', $selfClient->sentTexts, true), 'img alt on translate="no" element must NOT be sent');
a11yAssert(!in_array('Auch nicht übersetzen', $selfClient->sentTexts, true), '<a title> on translate="no" element must NOT be sent');
a11yAssert(!in_array('Button-aria', $selfClient->sentTexts, true), '<button aria-label> on translate="no" element must NOT be sent');
a11yAssert(in_array('Normales Bildtitel', $selfClient->sentTexts, true), 'Untagged img alt still translates as control');

// 12. Project `exclude_selectors` (.no-translate / #hero etc.) must scope
// accessibility attributes the same way it scopes text nodes, otherwise
// the existing exclusion contract regresses for alt / title / aria-label
// / placeholder traffic.
update_option(Options::OPTION_KEY, array_merge(Options::defaults(), [
    'enabled' => true,
    'api_key' => 'dg_test_key',
    'source_language' => 'de',
    'target_languages' => ['en'],
    'exclude_selectors' => ".no-translate\n#hero",
]));
$excludeClient = new DeepglotA11yFakeClient();
$excludeTranslator = new HtmlTranslator($excludeClient, $options, new DeepglotA11yNullCache());
$excludeHtml = '<!DOCTYPE html><html><head></head><body>'
    . '<div class="no-translate"><img alt="Bild im no-translate Block" src="/x.jpg"></div>'
    . '<section id="hero"><a title="Hero Link" href="/">Link</a></section>'
    . '<div class="content"><img alt="Bild im normalen Block" src="/y.jpg"></div>'
    . '</body></html>';
$excludeTranslator->translate($excludeHtml, 'en');
a11yAssert(!in_array('Bild im no-translate Block', $excludeClient->sentTexts, true), '.no-translate ancestor must exclude img alt');
a11yAssert(!in_array('Hero Link', $excludeClient->sentTexts, true), '#hero ancestor must exclude <a title>');
a11yAssert(in_array('Bild im normalen Block', $excludeClient->sentTexts, true), 'Non-excluded ancestor still allows img alt');

// 13. data-deepglot-no-translate is the canonical "plugin-owned subtree"
// marker. The language switcher uses it on its <aside> so the same
// HTML pipeline that translates the rest of the page never re-translates
// switcher labels (otherwise "English" comes out as "[en] English").
$dgClient     = new DeepglotA11yFakeClient();
$dgTranslator = new HtmlTranslator($dgClient, $options, new DeepglotA11yNullCache());
$dgHtml = '<!DOCTYPE html><html><head></head><body>'
    . '<aside data-deepglot-no-translate><span>English bleibt unangetastet</span><a title="Switcher Titel" href="/en/">EN</a><img alt="Switcher Flagge" src="/x.svg"></aside>'
    . '<p>Normaler Absatz wird übersetzt.</p>'
    . '</body></html>';
$dgTranslator->translate($dgHtml, 'en');
a11yAssert(!in_array('English bleibt unangetastet', $dgClient->sentTexts, true), 'Text inside data-deepglot-no-translate subtree must not be sent');
a11yAssert(!in_array('Switcher Titel', $dgClient->sentTexts, true), '<a title> inside data-deepglot-no-translate must not be sent');
a11yAssert(!in_array('Switcher Flagge', $dgClient->sentTexts, true), '<img alt> inside data-deepglot-no-translate must not be sent');
a11yAssert(in_array('Normaler Absatz wird übersetzt.', $dgClient->sentTexts, true), 'Text outside the subtree still translates as control');

fwrite(STDOUT, "AccessibilityAttributeTranslationTest: OK\n");
