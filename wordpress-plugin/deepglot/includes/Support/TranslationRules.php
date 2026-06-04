<?php

namespace Deepglot\Support;

/**
 * Canonical text-extraction rules shared between the two translation passes:
 *
 *  • the server-side {@see \Deepglot\Frontend\HtmlTranslator} (PHP, output
 *    buffer) which renders the initial, crawlable page, and
 *  • the client-side dynamic-content translator (JS, MutationObserver) which
 *    catches content added after load.
 *
 * The dynamic pass ships these values to the browser via wp_localize_script,
 * so the two passes can never disagree on which nodes are translatable.
 *
 * `SKIP_TAGS` is asserted to stay in sync with the server pass by
 * TranslationRulesTest (reflection), so this list stays the single source of
 * truth for both sides without coupling class loading.
 */
class TranslationRules
{
    /** Tags whose text content must never be translated. */
    public const SKIP_TAGS = [
        'script', 'style', 'pre', 'code', 'textarea', 'noscript', 'svg', 'math',
    ];

    /** Attribute that opts an element (and its whole subtree) out of translation. */
    public const NO_TRANSLATE_ATTR = 'data-deepglot-no-translate';

    /**
     * Plugin-owned subtrees the dynamic pass must never re-translate, as a
     * defence-in-depth complement to NO_TRANSLATE_ATTR: the language switcher
     * already carries the opt-out attribute, the visual editor shell is
     * injected client-side after this script runs.
     */
    public const OWN_SKIP_SELECTORS = [
        '.deepglot-switcher',
        '.deepglot-editor-segment',
        '#deepglot-editor-root',
    ];

    /**
     * Element/attribute pairs that carry user-facing copy outside the regular
     * text-node flow (alt text, tooltips, placeholders, ARIA labels, option
     * labels). The dynamic pass ships these to the browser so SPA-injected
     * elements that have *only* such an attribute (an icon button with an
     * aria-label, a search field with just a placeholder) still get localized.
     *
     * Drift-guarded against HtmlTranslator::TRANSLATABLE_BODY_ATTRIBUTES by
     * TranslationRulesTest.
     */
    public const TRANSLATABLE_BODY_ATTRIBUTES = [
        'img' => ['alt'],
        'a' => ['title', 'aria-label'],
        'button' => ['title', 'aria-label'],
        'input' => ['placeholder', 'aria-label'],
        'textarea' => ['placeholder', 'aria-label'],
        'select' => ['aria-label'],
        'label' => ['aria-label'],
        'optgroup' => ['label'],
        'option' => ['label'],
    ];

    /**
     * `<input value>` is UI copy only for these button-like types; every other
     * input type carries user data and must never be translated. Drift-guarded
     * against HtmlTranslator::TRANSLATABLE_INPUT_VALUE_TYPES.
     */
    public const TRANSLATABLE_INPUT_VALUE_TYPES = ['submit', 'button', 'reset'];

    /** Minimum trimmed length (in characters) for a text node to be worth translating. */
    public const MIN_TEXT_LENGTH = 2;

    /**
     * A trimmed string made up only of digits, whitespace, punctuation and
     * symbols carries no translatable copy. The JS pass uses the equivalent
     * `/^[\d\s\p{P}\p{S}]+$/u`.
     */
    public const NUMERIC_PUNCT_PATTERN = '/^[\d\s\p{P}\p{S}]+$/u';

    /**
     * Returns true when a trimmed string is worth sending to the API: long
     * enough and not made up purely of numbers / punctuation. Mirrors the
     * inline checks in {@see \Deepglot\Frontend\HtmlTranslator::collectTextNodes()}.
     */
    public static function isTranslatableText(string $trimmed): bool
    {
        if ($trimmed === '' || mb_strlen($trimmed) < self::MIN_TEXT_LENGTH) {
            return false;
        }

        return preg_match(self::NUMERIC_PUNCT_PATTERN, $trimmed) !== 1;
    }
}
