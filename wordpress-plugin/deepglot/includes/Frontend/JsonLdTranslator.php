<?php

namespace Deepglot\Frontend;

/**
 * Walks every <script type="application/ld+json"> element in a document,
 * extracts the user-facing string fields the translation pipeline can
 * safely localize, and writes the translated values back without losing
 * the surrounding JSON structure.
 *
 * Designed as a pure helper so it can ride on the same dedup/cache batch
 * that HtmlTranslator already builds for body text and head metadata.
 */
class JsonLdTranslator
{
    /**
     * JSON-LD keys whose string values are user-facing copy and should be
     * translated. URLs, IDs, controlled vocabulary, comma-separated tag
     * lists (`keywords`), enum values (`creativeWorkStatus`), and
     * controlled genre vocabulary are intentionally excluded so SEO
     * scoring on the localized page is not distorted.
     */
    private const TRANSLATABLE_KEYS = [
        'name',
        'description',
        'headline',
        'caption',
        'articleBody',
        'alternativeHeadline',
        'disambiguatingDescription',
        'about',
        'abstract',
    ];

    /**
     * JSON-LD keys whose value is a BCP-47 / ISO 639-1 language code.
     * They are rewritten to the active target language instead of being
     * sent through the translation engine.
     */
    private const LANGUAGE_KEYS = ['inLanguage'];

    /**
     * @return array<int, array{node: \DOMText, data: array<mixed>, strings: string[]}>
     */
    public function collect(\DOMDocument $doc): array
    {
        $mutations = [];
        $scripts = $doc->getElementsByTagName('script');

        foreach ($scripts as $script) {
            if (!$script instanceof \DOMElement) {
                continue;
            }

            if (strtolower(trim($script->getAttribute('type'))) !== 'application/ld+json') {
                continue;
            }

            $textNode = $this->firstTextChild($script);

            if ($textNode === null) {
                continue;
            }

            $raw = trim($textNode->data);

            if ($raw === '') {
                continue;
            }

            $decoded = json_decode($raw, true);

            if (!is_array($decoded)) {
                // Leave malformed JSON untouched so we never destroy theme output.
                continue;
            }

            $strings = [];
            $this->collectStrings($decoded, $strings);

            $mutations[] = [
                'node' => $textNode,
                'data' => $decoded,
                'strings' => array_values(array_unique($strings)),
            ];
        }

        return $mutations;
    }

    /**
     * @param array<int, array{node: \DOMText, data: array<mixed>, strings: string[]}> $mutations
     * @param array<string, string> $translations
     */
    public function apply(array $mutations, array $translations, string $targetLanguage): void
    {
        foreach ($mutations as $mutation) {
            $data = $mutation['data'];
            $this->applyTranslations($data, $translations, $targetLanguage);

            // JSON_HEX_TAG escapes "<" and ">" as < / > so a
            // translated value that happens to contain "</script>" cannot
            // break out of the surrounding <script> block. Slashes stay
            // unescaped to keep URL fields readable and identical to the
            // shape WordPress / Yoast emits originally.
            $encoded = wp_json_encode(
                $data,
                JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG
            );

            if (is_string($encoded)) {
                $mutation['node']->data = $encoded;
            }
        }
    }

    /**
     * @param array<mixed> $data
     * @param string[] $accumulator
     */
    private function collectStrings($data, array &$accumulator, ?string $parentKey = null): void
    {
        if (is_array($data)) {
            foreach ($data as $key => $value) {
                $childKey = is_string($key) ? $key : $parentKey;
                $this->collectStrings($value, $accumulator, $childKey);
            }

            return;
        }

        if (!is_string($data) || $parentKey === null) {
            return;
        }

        if (!in_array($parentKey, self::TRANSLATABLE_KEYS, true)) {
            return;
        }

        $trimmed = trim($data);

        if ($trimmed === '' || mb_strlen($trimmed) < 2) {
            return;
        }

        $accumulator[] = $data;
    }

    /**
     * @param array<mixed> $data
     * @param array<string, string> $translations
     */
    private function applyTranslations(array &$data, array $translations, string $targetLanguage, ?string $parentKey = null): void
    {
        foreach ($data as $key => &$value) {
            $childKey = is_string($key) ? $key : $parentKey;

            if (is_array($value)) {
                $this->applyTranslations($value, $translations, $targetLanguage, $childKey);
                continue;
            }

            if (!is_string($value) || $childKey === null) {
                continue;
            }

            if (in_array($childKey, self::LANGUAGE_KEYS, true)) {
                $value = $targetLanguage;
                continue;
            }

            if (
                in_array($childKey, self::TRANSLATABLE_KEYS, true)
                && isset($translations[$value])
            ) {
                $value = $translations[$value];
            }
        }
    }

    private function firstTextChild(\DOMElement $element): ?\DOMText
    {
        foreach ($element->childNodes as $child) {
            if ($child instanceof \DOMText) {
                return $child;
            }
        }

        return null;
    }
}
