<?php

namespace Deepglot\Frontend;

use Deepglot\Api\Client;
use Deepglot\Config\Options;
use Deepglot\Support\BotDetector;
use Deepglot\Support\HtmlDocument;
use Deepglot\Support\TranslationCache;
use Deepglot\Support\TranslationWarmer;

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
     * Element / attribute combinations that carry user-facing copy outside
     * the regular text-node flow. Image alt text, link/button tooltips,
     * form placeholders, submit-button labels and accessibility labels all
     * need to follow the visible page language, otherwise screen-reader
     * users keep hearing the source language on a translated page.
     *
     * Tags whose attributes look text-shaped but actually carry machine
     * identifiers (`<link>`, `<meta>`, `<area>` href targets, etc.) are
     * intentionally left out.
     */
    private const TRANSLATABLE_BODY_ATTRIBUTES = [
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
     * `<input value>` is only translated when the input renders a button.
     * Plain text / hidden / email / password / search inputs carry user
     * data, never UI copy.
     */
    private const TRANSLATABLE_INPUT_VALUE_TYPES = ['submit', 'button', 'reset'];

    /**
     * Tags whose attributes must never be translated even if they appear in
     * the whitelist above. Mirrors SKIP_TAGS plus `<noscript>` so the
     * fallback markup browsers without JS see stays in the source language.
     */
    private const ATTR_SKIP_ANCESTORS = ['script', 'style', 'noscript', 'template'];

    /** Maximum number of text nodes sent in one API request. */
    private const BATCH_SIZE = 200;

    /**
     * Maximum UTF-8 source-text bytes sent in one API request.
     *
     * 2 KB is roughly 500 tokens for typical Latin-script website copy. It
     * keeps the measured HD-Dental cold-page payload (4,273 source characters)
     * out of one provider request while leaving room for JSON, provider
     * instructions, and translated output. Using bytes is conservative for
     * multibyte scripts.
     */
    private const BATCH_SOURCE_BYTE_BUDGET = 2000;

    /**
     * Maximum number of API requests a single page render may wait for.
     *
     * The default is 0: the render path is cache-only and every fresh
     * translation is handed to `TranslationWarmer`. That is not a fallback, it
     * is what the latency forces — measured against production on 2026-08-03,
     * a batch costs ~9s before the provider translates anything, so there is
     * no batch size that is both worth sending and fast enough for a page
     * load. Blocking the visitor buys a 25–40s page; deferring buys one
     * source-language render, after which the cache is warm and every later
     * request is fast.
     *
     * Sites on a fast provider (DeepL, a local model) can raise this via
     * `deepglot_max_sync_batches` to translate inline again — each unit is one
     * additional request the visitor waits for.
     */
    public const MAX_SYNC_BATCHES = 0;

    private Client $client;
    private Options $options;
    private TranslationCache $cache;
    private JsonLdTranslator $jsonLd;
    private ?TranslationWarmer $warmer;

    public function __construct(
        Client $client,
        Options $options,
        TranslationCache $cache,
        ?JsonLdTranslator $jsonLd = null,
        ?TranslationWarmer $warmer = null
    ) {
        $this->client  = $client;
        $this->options = $options;
        $this->cache   = $cache;
        $this->jsonLd  = $jsonLd ?? new JsonLdTranslator();
        $this->warmer  = $warmer;
    }

    /**
     * API requests a render may wait for. 0 is meaningful: it makes the render
     * path cache-only and moves every fresh translation into the background.
     *
     * Without a warmer there is nowhere to defer to, so deferring would drop
     * the content entirely — translate everything inline in that case.
     */
    private function maxSyncBatches(): int
    {
        if ($this->warmer === null) {
            return PHP_INT_MAX;
        }

        $limit = function_exists('apply_filters')
            ? apply_filters('deepglot_max_sync_batches', self::MAX_SYNC_BATCHES)
            : self::MAX_SYNC_BATCHES;

        return is_numeric($limit) && (int) $limit >= 0 ? (int) $limit : self::MAX_SYNC_BATCHES;
    }

    /**
     * Translates all text nodes in the given HTML string from the source
     * language to $targetLanguage and returns the modified HTML.
     *
     * @param string $requestUrl Page URL for the SaaS URL analytics.
     * @param int    $bot        Legacy bot code (see BotDetector) — the SaaS
     *                           exempts bot traffic from the quota and serves
     *                           it cache-only.
     */
    public function translate(string $html, string $targetLanguage, string $requestUrl = '', int $bot = 0): string
    {
        return $this->translateDocument($html, $targetLanguage, false, $requestUrl, $bot)['html'];
    }

    /**
     * Translates an HTML document synchronously even when normal page renders
     * are configured as cache-only. Use this for one-shot output such as
     * emails, where a background warm-up cannot improve the already-sent
     * document.
     */
    public function translateInline(string $html, string $targetLanguage, string $requestUrl = '', int $bot = 0): string
    {
        return $this->translateDocument($html, $targetLanguage, false, $requestUrl, $bot, true)['html'];
    }

    /**
     * @return array{html: string, segments: array<int, array<string, string>>}
     */
    public function translateForEditor(string $html, string $targetLanguage, string $requestUrl = ''): array
    {
        // The visual editor needs the translated segments in this response;
        // a background warm-up cannot populate the current editing session.
        return $this->translateDocument($html, $targetLanguage, true, $requestUrl, 0, true);
    }

    /**
     * @return array{html: string, segments: array<int, array<string, string>>}
     */
    private function translateDocument(
        string $html,
        string $targetLanguage,
        bool $annotateSegments,
        string $requestUrl = '',
        int $bot = 0,
        bool $forceSynchronous = false
    ): array
    {
        if ($html === '') {
            return ['html' => $html, 'segments' => []];
        }

        $sourceLang = $this->options->getSourceLanguage();

        $doc = $this->loadHtml($html);

        // Collect all translatable DOMText nodes, head metadata attributes,
        // accessibility-relevant body attributes (img alt, aria-label,
        // placeholders, …) and JSON-LD strings (Yoast schema, etc.) into one
        // dedup batch.
        $nodes = $this->collectTextNodes($doc);
        $attrs = array_merge(
            $this->collectMetadataAttributes($doc),
            $this->collectAccessibilityAttributes($doc)
        );
        $jsonLdMutations = $this->jsonLd->collect($doc);

        if (empty($nodes) && empty($attrs) && empty($jsonLdMutations)) {
            return ['html' => $html, 'segments' => []];
        }

        // Deduplicate texts so we don't pay twice for the same string.
        $jsonLdStrings = [];
        foreach ($jsonLdMutations as $mutation) {
            foreach ($mutation['strings'] as $value) {
                $jsonLdStrings[] = $value;
            }
        }

        $texts = array_values(array_unique(array_merge(
            array_map(static fn(\DOMText $n) => $n->data, $nodes),
            array_map(static fn(\DOMAttr $a) => $a->value, $attrs),
            $jsonLdStrings
        )));

        // Load from cache.
        $cached  = $this->cache->getMany($texts, $sourceLang, $targetLanguage);
        $missing = array_values(array_filter($texts, static fn(string $t) => !isset($cached[$t])));

        // Fetch missing translations from API. Multi-batch pages dispatch
        // through translateBatches() so the client can run them in parallel
        // (Requests v2 / curl_multi) instead of paying one round trip per
        // batch. Single-batch pages keep the simpler translate() path.
        //
        // Only a bounded number of batches is translated inline. Fresh
        // translations are provider-bound work — measured from the jobspot.at
        // webserver on 2026-08-03, a batch costs ~9s before the provider
        // returns anything, plus ~0.9s per segment — so waiting for a whole
        // cold page means a 25–40s render. Whatever is not translated inline
        // is queued for background warming instead, which converges the page
        // on the next request rather than on this visitor's patience.
        $apiResults = [];
        $batches = $this->buildTranslationBatches($missing);
        $syncLimit = $forceSynchronous ? PHP_INT_MAX : $this->maxSyncBatches();

        $syncBatches = $syncLimit > 0 ? array_slice($batches, 0, $syncLimit) : [];
        $deferred = array_merge([], ...array_slice($batches, count($syncBatches)));

        if (count($syncBatches) > 1) {
            $batchResults = $this->client->translateBatches($syncBatches, $sourceLang, $targetLanguage, $requestUrl, $bot);

            foreach ($batchResults as $result) {
                $this->mergeTranslateResult($apiResults, $result);
            }
        } elseif (!empty($syncBatches)) {
            $result = $this->client->translate($syncBatches[0], $sourceLang, $targetLanguage, $requestUrl, $bot);
            $this->mergeTranslateResult($apiResults, $result);
        }

        // Whatever did not come back — a failed batch, a partial response —
        // must not be lost: without a retry path the page stays in the source
        // language on every later request too, because nothing was written to
        // the cache.
        foreach ($syncBatches as $batch) {
            foreach ($batch as $text) {
                if (!isset($apiResults[$text])) {
                    $deferred[] = $text;
                }
            }
        }

        // Bot traffic is served cache-only (issue #147) and must never trigger
        // quota spend, so crawlers observe but never fill the warm queue.
        if (!empty($deferred) && $this->warmer !== null && $bot < BotDetector::OTHER) {
            $this->warmer->enqueue($deferred, $sourceLang, $targetLanguage, $requestUrl);
        }

        // Persist new translations in cache. On bot requests the SaaS is
        // cache-only: uncached words come back as identity mappings
        // (to == from), not translations. Persisting those would poison the
        // 30-day transient cache for later human visitors (#163), so identity
        // pairs are dropped here for bot traffic. Human/provider-backed
        // results keep caching identical strings (proper nouns etc.).
        $cacheable = $apiResults;

        if ($bot >= BotDetector::OTHER) {
            $cacheable = array_filter(
                $cacheable,
                static fn(string $translated, string $original): bool => $translated !== $original,
                ARRAY_FILTER_USE_BOTH
            );
        }

        if (!empty($cacheable)) {
            $this->cache->setMany($cacheable, $sourceLang, $targetLanguage);
        }

        $all = array_merge($cached, $apiResults);

        if (empty($all) && empty($jsonLdMutations)) {
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

        // Apply translations + inLanguage rewrite to every JSON-LD block,
        // even when no body text matched the available translations — the
        // language switch alone is worth one pass.
        if (!empty($jsonLdMutations)) {
            $this->jsonLd->apply($jsonLdMutations, $all, $targetLanguage);
        }

        return [
            'html' => $this->saveHtml($doc),
            'segments' => $segments,
        ];
    }

    /**
     * Builds stable batches bounded by both item count and source-text size.
     * A single text larger than the byte budget remains intact in its own
     * batch because splitting it would break the API's one-to-one mapping.
     *
     * @param string[] $texts
     * @return array<int, string[]>
     */
    private function buildTranslationBatches(array $texts): array
    {
        $batches = [];
        $batch = [];
        $batchBytes = 0;

        foreach ($texts as $text) {
            $textBytes = strlen($text);

            if (
                $batch !== []
                && (
                    count($batch) >= self::BATCH_SIZE
                    || $batchBytes + $textBytes > self::BATCH_SOURCE_BYTE_BUDGET
                )
            ) {
                $batches[] = $batch;
                $batch = [];
                $batchBytes = 0;
            }

            $batch[] = $text;
            $batchBytes += $textBytes;

            if ($textBytes > self::BATCH_SOURCE_BYTE_BUDGET) {
                $batches[] = $batch;
                $batch = [];
                $batchBytes = 0;
            }
        }

        if ($batch !== []) {
            $batches[] = $batch;
        }

        return $batches;
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
            // Deepglot-owned subtrees (language switcher, debug widgets,
            // SaaS-injected UI) mark themselves with this attribute so
            // they never get re-translated and end up shipping
            // "[en] English" gibberish.
            'not(ancestor-or-self::*[@data-deepglot-no-translate])',
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

    /**
     * @param array<string, string> $accumulator
     * @param mixed $result
     */
    private function mergeTranslateResult(array &$accumulator, $result): void
    {
        if (
            is_wp_error($result)
            || !is_array($result)
            || !isset($result['from_words'], $result['to_words'])
            || !is_array($result['from_words'])
            || !is_array($result['to_words'])
        ) {
            return;
        }

        foreach ($result['from_words'] as $index => $original) {
            if (isset($result['to_words'][$index])) {
                $accumulator[$original] = $result['to_words'][$index];
            }
        }
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

    /**
     * Walks the body for elements that carry user-facing copy in HTML
     * attributes — `<img alt>`, `<a title>`, `<button aria-label>`,
     * `<input placeholder>`, `<input type="submit" value>`, etc. The returned
     * `DOMAttr` nodes plug into the same dedup batch the meta attributes use.
     *
     * @return \DOMAttr[]
     */
    private function collectAccessibilityAttributes(\DOMDocument $doc): array
    {
        $body = $doc->getElementsByTagName('body')->item(0);
        if (!$body instanceof \DOMElement) {
            return [];
        }

        $xpath = new \DOMXPath($doc);
        $result = [];

        foreach (self::TRANSLATABLE_BODY_ATTRIBUTES as $tagName => $attributeNames) {
            $elements = $xpath->query('.//' . $tagName, $body);
            if ($elements === false) {
                continue;
            }

            foreach ($elements as $element) {
                if (!$element instanceof \DOMElement) {
                    continue;
                }

                if ($this->hasSkippedAttributeAncestor($element)) {
                    continue;
                }

                if ($this->matchesExcludedSelector($element)) {
                    continue;
                }

                foreach ($attributeNames as $attributeName) {
                    $attr = $element->getAttributeNode($attributeName);
                    if (!$attr instanceof \DOMAttr) {
                        continue;
                    }

                    if (!$this->isTranslatableAttributeValue($attr->value)) {
                        continue;
                    }

                    $result[] = $attr;
                }

                // <input value> is gated on the input type — only submit /
                // button / reset render visible UI copy. All other input
                // types carry user data and must stay untranslated.
                if ($tagName === 'input') {
                    $valueAttr = $element->getAttributeNode('value');
                    if ($valueAttr instanceof \DOMAttr && $this->isTranslatableAttributeValue($valueAttr->value)) {
                        $type = strtolower(trim($element->getAttribute('type')));
                        if (in_array($type, self::TRANSLATABLE_INPUT_VALUE_TYPES, true)) {
                            $result[] = $valueAttr;
                        }
                    }
                }
            }
        }

        return $result;
    }

    private function isTranslatableAttributeValue(string $value): bool
    {
        $trimmed = trim($value);
        if ($trimmed === '' || mb_strlen($trimmed) < 2) {
            return false;
        }

        // Pure numeric / punctuation-only values are never UI copy.
        if (preg_match('/^[\d\s\p{P}\p{S}]+$/u', $trimmed)) {
            return false;
        }

        return true;
    }

    /**
     * Mirrors the `ancestor-or-self::*` semantics the text-node collector
     * uses: the walk starts at the element itself so a single
     * `<img translate="no" alt="…">` opts out, not only elements wrapped
     * in a no-translate ancestor.
     */
    private function hasSkippedAttributeAncestor(\DOMElement $element): bool
    {
        $node = $element;
        while ($node !== null) {
            if ($node instanceof \DOMElement) {
                $tag = strtolower($node->tagName);
                if (in_array($tag, self::ATTR_SKIP_ANCESTORS, true)) {
                    return true;
                }
                if ($node->hasAttribute('translate') && strtolower($node->getAttribute('translate')) === 'no') {
                    return true;
                }
                if ($node->hasAttribute('data-deepglot-no-translate')) {
                    return true;
                }
            }
            $node = $node->parentNode;
        }
        return false;
    }

    /**
     * Honours the project's `exclude_selectors` option for accessibility
     * attributes the same way `collectTextNodes` honours it for text nodes.
     * Without this mirror, operators that excluded `.no-translate` or
     * `#hero` for body text would silently see those elements' `alt`,
     * `title`, `aria-label` and `placeholder` traffic sent to the API.
     */
    private function matchesExcludedSelector(\DOMElement $element): bool
    {
        $selectors = $this->options->getExcludedSelectors();
        if (empty($selectors)) {
            return false;
        }

        $classSelectors = [];
        $idSelectors = [];
        foreach ($selectors as $selector) {
            if (str_starts_with($selector, '.') && strlen($selector) > 1) {
                $classSelectors[] = substr($selector, 1);
            } elseif (str_starts_with($selector, '#') && strlen($selector) > 1) {
                $idSelectors[] = substr($selector, 1);
            }
        }

        if (empty($classSelectors) && empty($idSelectors)) {
            return false;
        }

        $node = $element;
        while ($node !== null) {
            if ($node instanceof \DOMElement) {
                foreach ($idSelectors as $id) {
                    if ($node->getAttribute('id') === $id) {
                        return true;
                    }
                }
                if (!empty($classSelectors)) {
                    $classAttr = $node->getAttribute('class');
                    if ($classAttr !== '') {
                        $classes = preg_split('/\s+/', $classAttr) ?: [];
                        foreach ($classSelectors as $cls) {
                            if (in_array($cls, $classes, true)) {
                                return true;
                            }
                        }
                    }
                }
            }
            $node = $node->parentNode;
        }

        return false;
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
        return HtmlDocument::load($html);
    }

    private function saveHtml(\DOMDocument $doc): string
    {
        return HtmlDocument::save($doc);
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
