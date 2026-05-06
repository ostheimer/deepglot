<?php

namespace Deepglot\Frontend;

use Deepglot\Api\Client;
use Deepglot\Config\Options;
use Deepglot\Support\TranslationCache;

/**
 * Parses an HTML document, extracts translatable text nodes, sends them
 * in one batch to the Deepglot API and replaces them with the translations.
 *
 * Uses PHP's built-in DOMDocument / DOMXPath – no external dependencies.
 */
class HtmlTranslator
{
    /** Tags whose text content must never be translated. */
    private const SKIP_TAGS = [
        'script', 'style', 'pre', 'code', 'textarea', 'noscript',
        'svg', 'math',
    ];

    /**
     * Meta-tag selectors whose `content` attribute carries human-readable
     * copy that should be translated. Values are matched case-insensitively.
     *
     * Only selectors with user-facing text are listed — robots, generator,
     * keywords, viewport, charset and similar machine-only meta tags are
     * intentionally excluded.
     */
    private const TRANSLATABLE_META = [
        'name' => [
            'description',
            'twitter:title',
            'twitter:description',
            'twitter:image:alt',
        ],
        'property' => [
            'og:title',
            'og:description',
            'og:site_name',
            'og:image:alt',
        ],
        'itemprop' => [
            'name',
            'description',
            'headline',
        ],
    ];

    /**
     * Maximum number of text nodes sent in one API request.
     *
     * The Deepglot backend translates each batch in a single OpenAI / DeepL
     * call, so larger batches save round-trips at the cost of bigger prompts.
     * 200 keeps the prompt comfortably below the model context window while
     * roughly halving the number of sequential calls compared to 100.
     */
    private const BATCH_SIZE = 200;

    private Client $client;
    private Options $options;
    private TranslationCache $cache;

    public function __construct(Client $client, Options $options, TranslationCache $cache)
    {
        $this->client  = $client;
        $this->options = $options;
        $this->cache   = $cache;
    }

    /**
     * Translates all text nodes in the given HTML string from the source
     * language to $targetLanguage and returns the modified HTML.
     */
    public function translate(string $html, string $targetLanguage): string
    {
        return $this->translateDocument($html, $targetLanguage, false)['html'];
    }

    /**
     * @return array{html: string, segments: array<int, array<string, string>>}
     */
    public function translateForEditor(string $html, string $targetLanguage): array
    {
        return $this->translateDocument($html, $targetLanguage, true);
    }

    /**
     * @return array{html: string, segments: array<int, array<string, string>>}
     */
    private function translateDocument(string $html, string $targetLanguage, bool $annotateSegments): array
    {
        if ($html === '') {
            return ['html' => $html, 'segments' => []];
        }

        $sourceLang = $this->options->getSourceLanguage();

        $doc = $this->loadHtml($html);

        // Collect all translatable DOMText nodes plus head metadata attributes.
        $nodes = $this->collectTextNodes($doc);
        $attrs = $this->collectMetadataAttributes($doc);

        if (empty($nodes) && empty($attrs)) {
            return ['html' => $html, 'segments' => []];
        }

        // Deduplicate texts so we don't pay twice for the same string.
        $texts = array_values(array_unique(array_merge(
            array_map(static fn(\DOMText $n) => $n->data, $nodes),
            array_map(static fn(\DOMAttr $a) => $a->value, $attrs)
        )));

        // Load from cache.
        $cached  = $this->cache->getMany($texts, $sourceLang, $targetLanguage);
        $missing = array_values(array_filter($texts, static fn(string $t) => !isset($cached[$t])));

        // Fetch missing translations from API in batches.
        $apiResults = [];

        foreach (array_chunk($missing, self::BATCH_SIZE) as $batch) {
            $result = $this->client->translate($batch, $sourceLang, $targetLanguage);

            if (
                !is_wp_error($result)
                && isset($result['from_words'], $result['to_words'])
                && is_array($result['from_words'])
                && is_array($result['to_words'])
            ) {
                foreach ($result['from_words'] as $index => $original) {
                    if (isset($result['to_words'][$index])) {
                        $apiResults[$original] = $result['to_words'][$index];
                    }
                }
            }
        }

        // Persist new translations in cache.
        if (!empty($apiResults)) {
            $this->cache->setMany($apiResults, $sourceLang, $targetLanguage);
        }

        $all = array_merge($cached, $apiResults);

        if (empty($all)) {
            return ['html' => $html, 'segments' => []];
        }

        // Replace text node data in the DOM.
        $segments = [];
        $segmentIndex = 0;

        foreach ($nodes as $node) {
            $original = $node->data;

            if (isset($all[$original])) {
                // Editor mode wraps translated text in <span data-deepglot-segment-id>
                // for the visual editor. <head> children (notably <title>) cannot
                // host inline spans without producing invalid markup, so they are
                // translated in place even when annotateSegments is true.
                if ($annotateSegments && !$this->isInsideHead($node)) {
                    $this->replaceNodeWithSegment(
                        $node,
                        $original,
                        $all[$original],
                        $sourceLang,
                        $targetLanguage,
                        $segmentIndex,
                        $segments
                    );
                    $segmentIndex++;
                    continue;
                }

                $node->data = $all[$original];
            }
        }

        // Translate whitelisted head metadata attributes in place.
        foreach ($attrs as $attr) {
            $original = $attr->value;

            if (isset($all[$original])) {
                $attr->value = $all[$original];
            }
        }

        return [
            'html' => $this->saveHtml($doc),
            'segments' => $segments,
        ];
    }

    // -------------------------------------------------------------------------
    // DOM helpers
    // -------------------------------------------------------------------------

    /**
     * @return \DOMText[]
     */
    private function collectTextNodes(\DOMDocument $doc): array
    {
        $xpath = new \DOMXPath($doc);

        // Build an XPath expression that skips all SKIP_TAGS.
        $skipConditions = array_map(
            static fn(string $tag) => 'ancestor-or-self::' . $tag,
            self::SKIP_TAGS
        );
        $skipExpr = implode(' or ', $skipConditions);

        $conditions = [
            'not(' . $skipExpr . ')',
            'not(ancestor-or-self::*[@translate="no"])',
        ];
        $excludedSelectorExpr = $this->excludedSelectorXPathExpression();

        if ($excludedSelectorExpr !== '') {
            $conditions[] = 'not(' . $excludedSelectorExpr . ')';
        }

        $expr = '//text()[' . implode(' and ', $conditions) . ']';

        $textNodes = $xpath->query($expr);

        if ($textNodes === false) {
            return [];
        }

        $result = [];

        foreach ($textNodes as $node) {
            if (!$node instanceof \DOMText) {
                continue;
            }

            $trimmed = trim($node->data);

            // Skip whitespace-only nodes and very short fragments.
            if ($trimmed === '' || mb_strlen($trimmed) < 2) {
                continue;
            }

            // Skip nodes that are purely numeric / special characters.
            if (preg_match('/^[\d\s\p{P}\p{S}]+$/u', $trimmed)) {
                continue;
            }

            $result[] = $node;
        }

        return $result;
    }

    private function isInsideHead(\DOMNode $node): bool
    {
        $ancestor = $node->parentNode;

        while ($ancestor !== null) {
            if ($ancestor instanceof \DOMElement && strtolower($ancestor->tagName) === 'head') {
                return true;
            }

            $ancestor = $ancestor->parentNode;
        }

        return false;
    }

    /**
     * @return \DOMAttr[]
     */
    private function collectMetadataAttributes(\DOMDocument $doc): array
    {
        $head = $doc->getElementsByTagName('head')->item(0);

        if (!$head instanceof \DOMElement) {
            return [];
        }

        $result = [];
        $metas = $head->getElementsByTagName('meta');

        foreach ($metas as $meta) {
            if (!$meta instanceof \DOMElement) {
                continue;
            }

            $contentAttr = $meta->getAttributeNode('content');

            if (!$contentAttr instanceof \DOMAttr || $contentAttr->value === '') {
                continue;
            }

            if (!$this->isMetaContentTranslatable($meta)) {
                continue;
            }

            $trimmed = trim($contentAttr->value);

            if ($trimmed === '' || mb_strlen($trimmed) < 2) {
                continue;
            }

            $result[] = $contentAttr;
        }

        return $result;
    }

    private function isMetaContentTranslatable(\DOMElement $meta): bool
    {
        foreach (self::TRANSLATABLE_META as $attribute => $values) {
            if (!$meta->hasAttribute($attribute)) {
                continue;
            }

            $candidate = strtolower(trim($meta->getAttribute($attribute)));

            if (in_array($candidate, $values, true)) {
                return true;
            }
        }

        return false;
    }

    private function excludedSelectorXPathExpression(): string
    {
        $conditions = [];

        foreach ($this->options->getExcludedSelectors() as $selector) {
            if (str_starts_with($selector, '.') && strlen($selector) > 1) {
                $className = substr($selector, 1);
                $conditions[] = 'ancestor-or-self::*[contains(concat(" ", normalize-space(@class), " "), ' . $this->xpathLiteral(' ' . $className . ' ') . ')]';
            } elseif (str_starts_with($selector, '#') && strlen($selector) > 1) {
                $id = substr($selector, 1);
                $conditions[] = 'ancestor-or-self::*[@id = ' . $this->xpathLiteral($id) . ']';
            }
        }

        return implode(' or ', $conditions);
    }

    private function xpathLiteral(string $value): string
    {
        if (!str_contains($value, "'")) {
            return "'" . $value . "'";
        }

        if (!str_contains($value, '"')) {
            return '"' . $value . '"';
        }

        $parts = explode("'", $value);

        return "concat('" . implode("', \"'\", '", $parts) . "')";
    }

    private function loadHtml(string $html): \DOMDocument
    {
        $doc = new \DOMDocument('1.0', 'UTF-8');

        libxml_use_internal_errors(true);

        // The meta charset hint ensures DOMDocument preserves UTF-8.
        $doc->loadHTML(
            '<?xml encoding="UTF-8">' . $html,
            LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD | LIBXML_NOWARNING | LIBXML_NOERROR
        );

        libxml_clear_errors();

        return $doc;
    }

    private function saveHtml(\DOMDocument $doc): string
    {
        $html = $doc->saveHTML();

        if ($html === false) {
            return '';
        }

        // Remove the xml declaration we injected.
        $html = str_replace('<?xml encoding="UTF-8">', '', $html);

        return $html;
    }

    /**
     * @param array<int, array<string, string>> $segments
     */
    private function replaceNodeWithSegment(
        \DOMText $node,
        string $originalText,
        string $translatedText,
        string $sourceLanguage,
        string $targetLanguage,
        int $index,
        array &$segments
    ): void {
        $document = $node->ownerDocument;
        $parent = $node->parentNode;

        if (!$document instanceof \DOMDocument || $parent === null) {
            return;
        }

        preg_match('/^(\s*)(.*?)(\s*)$/us', $originalText, $originalParts);
        preg_match('/^(\s*)(.*?)(\s*)$/us', $translatedText, $translatedParts);

        $prefix = $originalParts[1] ?? '';
        $trimmedOriginal = $originalParts[2] ?? trim($originalText);
        $suffix = $originalParts[3] ?? '';
        $trimmedTranslated = $translatedParts[2] ?? trim($translatedText);

        $segmentId = 'dg-' . substr(md5($sourceLanguage . '|' . $targetLanguage . '|' . $trimmedOriginal . '|' . $index), 0, 12);

        if ($prefix !== '') {
            $parent->insertBefore($document->createTextNode($prefix), $node);
        }

        $span = $document->createElement('span');
        $span->setAttribute('data-deepglot-segment-id', $segmentId);
        $span->setAttribute('data-deepglot-lang-from', $sourceLanguage);
        $span->setAttribute('data-deepglot-lang-to', $targetLanguage);
        $span->setAttribute('class', 'deepglot-editor-segment');
        $span->appendChild($document->createTextNode($trimmedTranslated !== '' ? $trimmedTranslated : $translatedText));
        $parent->insertBefore($span, $node);

        if ($suffix !== '') {
            $parent->insertBefore($document->createTextNode($suffix), $node);
        }

        $parent->removeChild($node);

        $segments[] = [
            'id' => $segmentId,
            'originalText' => $trimmedOriginal !== '' ? $trimmedOriginal : trim($originalText),
            'translatedText' => $trimmedTranslated !== '' ? $trimmedTranslated : trim($translatedText),
            'langFrom' => $sourceLanguage,
            'langTo' => $targetLanguage,
        ];
    }
}
