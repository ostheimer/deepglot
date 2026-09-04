<?php

namespace Deepglot\Frontend;

use Deepglot\Config\Options;
use Deepglot\Support\BotDetector;
use Deepglot\Support\HtmlDocument;
use Deepglot\Support\RequestInput;
use Deepglot\Support\SiteRouting;
use Deepglot\Support\UrlTranslationSync;
use Deepglot\Support\UrlLanguageResolver;

/**
 * Captures the WordPress HTML output, translates text nodes via the
 * Deepglot API, rewrites internal links and injects hreflang tags.
 */
class OutputBuffer
{
    /** @var string[] */
    private const PLAIN_PERMALINK_ID_QUERY_VARS = [
        'p',
        'page_id',
        'attachment_id',
    ];

    /** @var string[] */
    private const CANONICAL_QUERY_VARS = [
        'p',
        'page_id',
        'attachment_id',
        's',
        'paged',
        'post_type',
    ];

    private Options $options;
    private UrlLanguageResolver $resolver;
    private HtmlTranslator $translator;
    private LinkRewriter $linkRewriter;
    private HreflangInjector $hreflangInjector;
    private RequestRouter $router;
    private SiteRouting $routing;
    private ?UrlTranslationSync $urlSync;

    public function __construct(
        Options $options,
        UrlLanguageResolver $resolver,
        HtmlTranslator $translator,
        LinkRewriter $linkRewriter,
        HreflangInjector $hreflangInjector,
        RequestRouter $router,
        SiteRouting $routing,
        ?UrlTranslationSync $urlSync = null
    ) {
        $this->options          = $options;
        $this->resolver         = $resolver;
        $this->translator       = $translator;
        $this->linkRewriter     = $linkRewriter;
        $this->hreflangInjector = $hreflangInjector;
        $this->router           = $router;
        $this->routing          = $routing;
        $this->urlSync          = $urlSync;
    }

    public function register(): void
    {
        add_action('template_redirect', [$this, 'startBuffer'], 0);
    }

    public function startBuffer(): void
    {
        if (!$this->canProcessCurrentRequest()) {
            return;
        }

        $targetLanguage = $this->detectTargetLanguage();

        // The admin toggle must gate the actual output pipeline, not only the
        // settings-sync payload. Bail before runtime config, exclusions, cache
        // reads or translation calls so an opted-out AMP response is untouched.
        if ($this->isAmpRequest() && !$this->options->shouldTranslateAmp()) {
            return;
        }

        // RequestRouter has already rewritten a localized slug to its source
        // path. Exclusions are configured against that canonical source URL;
        // the localized public URL is reserved for analytics and cache purges.
        if ($this->options->isUrlExcluded($this->sourceRequestUrl())) {
            return;
        }

        ob_start(function (string $html) use ($targetLanguage): string {
            return $targetLanguage === null
                ? $this->processSource($html)
                : $this->process($html, $targetLanguage);
        });
    }

    // -------------------------------------------------------------------------

    /**
     * Full pipeline: translate → rewrite links → inject hreflang.
     */
    public function process(string $html, string $targetLanguage): string
    {
        if ($html === '' || stripos($html, '<html') === false) {
            return $html;
        }

        $editorMode = $this->isEditorMode();
        $editorSegments = [];

        // Step 1: translate text nodes. Pass the page URL (SaaS URL analytics,
        // issue #147 found it was always empty) and the visitor's bot code —
        // the SaaS exempts bot traffic from the word quota and serves it from
        // its translation cache only, so crawlers grinding the long-tail
        // archive no longer burn the monthly quota.
        $requestUrl = $this->currentRequestUrl();
        $bot = BotDetector::detectCurrentRequest();

        if ($editorMode) {
            $translated = $this->translator->translateForEditor($html, $targetLanguage, $requestUrl);
            $html = $translated['html'];
            $editorSegments = $translated['segments'];
        } else {
            $html = $this->translator->translate($html, $targetLanguage, $requestUrl, $bot);
        }

        $this->emitUrlSyncDiagnostics($targetLanguage);

        // Steps 2 + 3 need the DOM, so load once.
        $doc = $this->loadDocument($html);

        // Step 2: rewrite internal links to include language prefix.
        $this->linkRewriter->rewrite($doc, $targetLanguage);

        // Step 3: inject hreflang tags.
        // Use the original (pre-rewrite) REQUEST_URI to get the canonical path.
        $rawUri        = RequestInput::server('REQUEST_URI', '/');
        $canonicalPath = $this->canonicalRequestLocation($rawUri);
        $this->hreflangInjector->inject(
            $doc,
            $canonicalPath,
            $targetLanguage,
            $this->allowsFallbackCanonical()
        );

        // Step 4: switch <html lang> to the target language and mark translate="no"
        // so browser extensions (Chrome auto-translate, etc.) don't double translate.
        $htmlEl = $doc->getElementsByTagName('html')->item(0);

        if ($htmlEl instanceof \DOMElement) {
            $htmlEl->setAttribute('lang', $targetLanguage);

            // PHP DOMDocument keeps xml:lang as an attribute node but
            // hasAttribute('xml:lang') / getAttributeNode('xml:lang') return
            // false because the colon is interpreted as a namespace prefix.
            // Iterate to find and update it directly.
            foreach ($htmlEl->attributes as $attr) {
                if ($attr instanceof \DOMAttr && strtolower($attr->name) === 'xml:lang') {
                    $attr->value = $targetLanguage;
                    break;
                }
            }

            if (!$htmlEl->hasAttribute('translate')) {
                $htmlEl->setAttribute('translate', 'no');
            }
        }

        if ($editorMode && !empty($editorSegments)) {
            $this->injectEditorShell($doc, $editorSegments);
        }

        // The disclosure is a SaaS-owned runtime setting. Add it after content
        // translation so the notice itself is never sent through a provider,
        // and only in the target-language pipeline (never processSource()).
        if ($this->options->shouldDisplayAiNotice()) {
            $this->injectAiTranslationNotice($doc, $targetLanguage);
        }

        $translatedHtml = $this->saveDocument($doc);

        if (!function_exists('apply_filters')) {
            return $translatedHtml;
        }

        /**
         * Filters the completed target-language HTML document.
         *
         * This is a trusted server-side extension point for site-specific
         * replacements such as localized media embeds. Invalid results and
         * callback failures are ignored so one malformed extension cannot
         * break the translated response.
         *
         * @param string $translatedHtml Completed translated HTML.
         * @param string $targetLanguage Target language code.
         * @param string $requestUrl      Current request URL.
         */
        try {
            $filteredHtml = apply_filters(
                'deepglot_translated_html',
                $translatedHtml,
                $targetLanguage,
                $requestUrl
            );
        } catch (\Throwable $exception) {
            return $translatedHtml;
        }

        return is_string($filteredHtml) && trim($filteredHtml) !== ''
            ? $filteredHtml
            : $translatedHtml;
    }

    /**
     * Adds the reciprocal language cluster to a source-language response
     * without translating content or rewriting source links.
     */
    public function processSource(string $html): string
    {
        if (!$this->isHtmlDocument($html)) {
            return $html;
        }

        $doc = $this->loadDocument($html);
        $rawUri = RequestInput::server('REQUEST_URI', '/');
        $canonicalPath = $this->canonicalRequestLocation($rawUri);
        $this->hreflangInjector->inject(
            $doc,
            $canonicalPath,
            null,
            $this->allowsFallbackCanonical()
        );

        return $this->saveDocument($doc);
    }

    private function injectAiTranslationNotice(\DOMDocument $doc, string $targetLanguage): void
    {
        foreach ($doc->getElementsByTagName('*') as $element) {
            if ($element instanceof \DOMElement && $element->hasAttribute('data-deepglot-ai-notice')) {
                return;
            }
        }

        $body = $doc->getElementsByTagName('body')->item(0);
        if (!$body instanceof \DOMElement) {
            return;
        }

        $notice = $doc->createElement('aside');
        $notice->setAttribute('class', 'deepglot-ai-notice');
        $notice->setAttribute('data-deepglot-ai-notice', 'true');
        $notice->setAttribute('role', 'note');
        $noticeContent = $this->aiTranslationNotice($targetLanguage);
        if ($noticeContent['fallback']) {
            $notice->setAttribute('lang', $noticeContent['language']);
        }
        $notice->appendChild($doc->createTextNode($noticeContent['text']));
        $body->appendChild($notice);
    }

    /** @return array{language: string, text: string, fallback: bool} */
    private function aiTranslationNotice(string $targetLanguage): array
    {
        $primaryLanguage = strtolower(explode('-', trim($targetLanguage), 2)[0]);
        $notices = [
            'de' => 'Diese Seite wurde mit KI übersetzt.',
            'en' => 'This page was translated with AI.',
            'es' => 'Esta página fue traducida con IA.',
            'fr' => 'Cette page a été traduite par une IA.',
            'it' => "Questa pagina è stata tradotta con l'IA.",
        ];

        $noticeLanguage = isset($notices[$primaryLanguage]) ? $primaryLanguage : 'en';

        return [
            'language' => $noticeLanguage,
            'text' => $notices[$noticeLanguage],
            'fallback' => $noticeLanguage !== $primaryLanguage,
        ];
    }

    // -------------------------------------------------------------------------

    private function canProcessCurrentRequest(): bool
    {
        if (is_admin() || wp_doing_ajax() || wp_is_json_request()) {
            return false;
        }

        foreach (['is_feed', 'is_trackback', 'is_robots', 'is_favicon'] as $conditional) {
            if (function_exists($conditional) && $conditional()) {
                return false;
            }
        }

        if (!$this->options->isEnabled() || !$this->options->isConfigured()) {
            return false;
        }

        if (headers_sent()) {
            return false;
        }

        return true;
    }

    private function isHtmlDocument(string $html): bool
    {
        if ($html === '') {
            return false;
        }

        $withoutBom = preg_replace('/^\xEF\xBB\xBF/', '', $html) ?? $html;
        $documentStart = ltrim($withoutBom);

        return preg_match(
            '/\A(?:<!--.*?-->\s*)*(?:<!doctype\s+html\b[^>]*>\s*)?<html(?:\s|>)/is',
            $documentStart
        ) === 1;
    }

    private function allowsFallbackCanonical(): bool
    {
        $statusCode = http_response_code();

        return $statusCode === false
            || $statusCode === 0
            || ($statusCode >= 200 && $statusCode < 300);
    }

    /**
     * Keeps the small set of content-defining WordPress parameters in generated
     * canonicals and hreflang URLs. Arbitrary request parameters are commonly
     * campaign or click identifiers and must not create canonical URL variants.
     */
    private function canonicalRequestLocation(string $uri): string
    {
        $canonicalPath = $this->routing->getCanonicalPath($uri);
        $rawQuery = wp_parse_url($uri, PHP_URL_QUERY);

        if (!is_string($rawQuery) || $rawQuery === '') {
            return $canonicalPath;
        }

        $query = $this->parseCanonicalQuery($rawQuery);
        $plainPermalinkQuery = $this->canonicalPlainPermalinkIdQuery($query);

        if ($plainPermalinkQuery !== null) {
            if ($plainPermalinkQuery === []) {
                return $canonicalPath;
            }

            return $canonicalPath . '?' . http_build_query(
                $plainPermalinkQuery,
                '',
                '&',
                PHP_QUERY_RFC3986
            );
        }

        if (!array_key_exists('s', $query)) {
            $paged = $this->canonicalSinglePositiveInteger($query, 'paged');
            if ($paged === null || $paged === '1') {
                return $canonicalPath;
            }

            return $canonicalPath . '?' . http_build_query(
                ['paged' => $paged],
                '',
                '&',
                PHP_QUERY_RFC3986
            );
        }

        if (count($query['s']) !== 1) {
            return $canonicalPath;
        }

        $canonicalQuery = ['s' => $query['s'][0]];

        $paged = $this->canonicalSinglePositiveInteger($query, 'paged');
        if ($paged !== null && $paged !== '1') {
            $canonicalQuery['paged'] = $paged;
        }

        if (
            isset($query['post_type'])
            && count($query['post_type']) === 1
            && preg_match('/\A[a-z0-9_-]{1,20}\z/', $query['post_type'][0]) === 1
        ) {
            $canonicalQuery['post_type'] = $query['post_type'][0];
        }

        return $canonicalPath . '?' . http_build_query(
            $canonicalQuery,
            '',
            '&',
            PHP_QUERY_RFC3986
        );
    }

    /**
     * Plain-permalink post, page and attachment IDs are the route itself. Keep
     * exactly one scalar positive ID, while rejecting ambiguous, nested or
     * otherwise malformed selectors.
     *
     * @param array<string, string[]> $query
     * @return array<string, string>
     */
    private function canonicalPlainPermalinkIdQuery(array $query): ?array
    {
        $selectedKeys = [];

        foreach (self::PLAIN_PERMALINK_ID_QUERY_VARS as $key) {
            if (array_key_exists($key, $query)) {
                $selectedKeys[] = $key;
            }
        }

        if ($selectedKeys === []) {
            return null;
        }

        if (count($selectedKeys) !== 1) {
            return [];
        }

        $selectedKey = $selectedKeys[0];
        if (count($query[$selectedKey]) !== 1) {
            return [];
        }

        $selectedValue = $this->canonicalPositiveInteger($query[$selectedKey][0]);

        if ($selectedValue === null) {
            return [];
        }

        return [$selectedKey => $selectedValue];
    }

    /**
     * Parses only exact canonical query-variable names. parse_str() cannot be
     * used for this allowlist because it normalizes dots, spaces and NUL bytes
     * in keys, which can turn an untrusted key into an allowed WordPress key.
     *
     * @return array<string, string[]>
     */
    private function parseCanonicalQuery(string $rawQuery): array
    {
        $query = [];

        foreach (explode('&', $rawQuery) as $pair) {
            [$rawKey, $rawValue] = array_pad(explode('=', $pair, 2), 2, '');
            $key = urldecode($rawKey);

            if (!in_array($key, self::CANONICAL_QUERY_VARS, true)) {
                continue;
            }

            if (!isset($query[$key])) {
                $query[$key] = [];
            }

            $query[$key][] = urldecode($rawValue);
        }

        return $query;
    }

    /**
     * @param array<string, string[]> $query
     */
    private function canonicalSinglePositiveInteger(array $query, string $key): ?string
    {
        if (!isset($query[$key]) || count($query[$key]) !== 1) {
            return null;
        }

        return $this->canonicalPositiveInteger($query[$key][0]);
    }

    /**
     * Normalizes the decimal integers WordPress later represents as native
     * integers. Rejecting values above PHP_INT_MAX avoids overflow-dependent
     * canonical URLs on 32-bit and 64-bit hosts.
     *
     * @param mixed $value
     */
    private function canonicalPositiveInteger($value): ?string
    {
        if (!is_string($value) || preg_match('/\A[0-9]+\z/', $value) !== 1) {
            return null;
        }

        $normalized = ltrim($value, '0');
        if ($normalized === '') {
            return null;
        }

        $maximum = (string) PHP_INT_MAX;
        if (
            strlen($normalized) > strlen($maximum)
            || (strlen($normalized) === strlen($maximum) && strcmp($normalized, $maximum) > 0)
        ) {
            return null;
        }

        return $normalized;
    }

    private function detectTargetLanguage(): ?string
    {
        // The RequestRouter already stripped the language prefix from REQUEST_URI,
        // but it stored the detected language for us.
        $detected = $this->router->getCurrentLanguage();

        if ($detected !== null) {
            return $detected;
        }

        // Fallback: re-detect from the original URI (before REQUEST_URI was rewritten).
        // The router stores the original URI in a request attribute; if not available,
        // detect from the still-current REQUEST_URI.
        $uri = RequestInput::server('REQUEST_URI', '/');
        $host = RequestInput::server('HTTP_HOST');
        return $this->routing->detectLanguage($uri, $host);
    }

    private function currentRequestUrl(): string
    {
        $originalUri = $this->router->getOriginalRequestUri();
        $uri = RequestInput::server('REQUEST_URI', '/');
        $targetLanguage = $this->detectTargetLanguage();

        // RequestRouter has already reduced a localized request to its
        // canonical source path by the time the output buffer runs. Rebuild
        // the public localized URL so analytics and background cache purges
        // follow the page the visitor actually requested.
        if ($targetLanguage !== null) {
            return $this->routing->buildUrlForLanguage($uri, $targetLanguage);
        }

        return $this->sourceRequestUrl();
    }

    private function sourceRequestUrl(): string
    {
        $uri = RequestInput::server('REQUEST_URI', '/');

        if (
            $this->urlSync !== null
            && $this->urlSync->isCurrentRequest($originalUri)
        ) {
            $uri = $this->urlSync->stripQueryArg($originalUri ?? $uri);
        }

        if (function_exists('home_url')) {
            return home_url($uri);
        }

        return $uri;
    }

    /**
     * A controlled sync must distinguish a fully warm page from an HTTP 200
     * that still contains source-language fallbacks. These headers are only
     * emitted for the current signed job token and the response is never
     * reusable as a public full-page-cache object.
     */
    private function emitUrlSyncDiagnostics(string $targetLanguage): void
    {
        if (
            $this->urlSync === null
            || !$this->urlSync->isCurrentRequest($this->router->getOriginalRequestUri())
        ) {
            return;
        }

        if (function_exists('nocache_headers')) {
            nocache_headers();
        }

        if (headers_sent()) {
            return;
        }

        header('X-Deepglot-Sync: 1');
        header('X-Deepglot-Sync-Language: ' . $targetLanguage);
        header(
            'X-Deepglot-Sync-Pending-Segments: '
            . $this->translator->getLastPendingSegmentCount()
        );
    }

    /**
     * Detect AMP across the official AMP plugin helper, legacy query-var mode,
     * and canonical `/amp/` endpoints. Each fallback is deliberately narrow so
     * ordinary slugs containing the letters "amp" are not misclassified.
     */
    private function isAmpRequest(): bool
    {
        if (function_exists('is_amp_endpoint') && is_amp_endpoint()) {
            return true;
        }

        if (function_exists('amp_is_request') && amp_is_request()) {
            return true;
        }

        $queryValue = function_exists('get_query_var') ? get_query_var('amp', null) : null;
        if ($queryValue !== null && $queryValue !== '' && $queryValue !== false && $queryValue !== '0' && $queryValue !== 0) {
            return true;
        }

        if (RequestInput::hasQuery('amp')) {
            $getValue = RequestInput::query('amp');
            if ($getValue !== '' && $getValue !== '0' && $getValue !== 0 && $getValue !== false) {
                return true;
            }
        }

        $uri = RequestInput::server('REQUEST_URI', '/');
        $path = (string) wp_parse_url($uri, PHP_URL_PATH);

        return preg_match('#/amp/?$#i', $path) === 1;
    }

    private function loadDocument(string $html): \DOMDocument
    {
        return HtmlDocument::load($html);
    }

    private function saveDocument(\DOMDocument $doc): string
    {
        return HtmlDocument::save($doc);
    }

    private function isEditorMode(): bool
    {
        return RequestInput::hasQuery('deepglot_editor')
            && RequestInput::hasQuery('deepglot_editor_token')
            && RequestInput::hasQuery('deepglot_editor_project');
    }

    /**
     * @param array<int, array<string, string>> $segments
     */
    private function injectEditorShell(\DOMDocument $doc, array $segments): void
    {
        $projectId = RequestInput::query('deepglot_editor_project');
        $token = RequestInput::query('deepglot_editor_token');

        if ($projectId === '' || $token === '') {
            return;
        }

        $apiBaseUrl = rtrim($this->options->getApiBaseUrl(), '/');
        $manifestJson = wp_json_encode([
            'apiBaseUrl' => $apiBaseUrl,
            'projectId' => $projectId,
            'token' => $token,
            'requestUrl' => home_url(add_query_arg([], RequestInput::server('REQUEST_URI', '/'))),
            'segments' => array_values($segments),
        ]);

        if (!is_string($manifestJson)) {
            return;
        }

        $script = $doc->createElement('script');
        $script->setAttribute('id', 'deepglot-editor-manifest');
        $script->setAttribute('type', 'application/json');
        $script->appendChild($doc->createTextNode($manifestJson));

        $style = $doc->createElement('style');
        $style->appendChild($doc->createTextNode('
.deepglot-editor-segment{cursor:pointer;transition:background-color .15s ease,outline-color .15s ease;}
.deepglot-editor-segment:hover{outline:1px dashed #f03b22;background:rgba(240,59,34,.08);}
.deepglot-editor-segment[data-deepglot-selected="true"]{outline:2px solid #f03b22;background:rgba(240,59,34,.12);}
#deepglot-editor-root{position:fixed;top:24px;right:24px;z-index:2147483647;width:360px;max-width:calc(100vw - 32px);background:#fff;border:1px solid #dbe4ff;border-radius:16px;box-shadow:0 24px 80px rgba(15,23,42,.18);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#111827;}
#deepglot-editor-root[hidden]{display:none;}
#deepglot-editor-root .dg-header{padding:16px 18px;border-bottom:1px solid #fff0ec;background:linear-gradient(135deg,#fff0ec,#ffffff);}
#deepglot-editor-root .dg-title{font-size:14px;font-weight:700;margin:0 0 4px;}
#deepglot-editor-root .dg-subtitle{font-size:12px;color:#64748b;margin:0;}
#deepglot-editor-root .dg-body{padding:16px 18px;display:grid;gap:12px;}
#deepglot-editor-root label{display:grid;gap:6px;font-size:12px;font-weight:600;color:#475569;}
#deepglot-editor-root textarea,#deepglot-editor-root input{width:100%;border:1px solid #dbe4ff;border-radius:10px;padding:10px 12px;font:inherit;color:#111827;background:#fff;}
#deepglot-editor-root textarea{min-height:120px;resize:vertical;}
#deepglot-editor-root .dg-actions{display:flex;justify-content:space-between;gap:10px;}
#deepglot-editor-root button{appearance:none;border:none;border-radius:10px;padding:10px 14px;font:inherit;font-weight:600;cursor:pointer;}
#deepglot-editor-root .dg-primary{background:#d92f19;color:#fff;}
#deepglot-editor-root .dg-secondary{background:#fff0ec;color:#9f2818;}
#deepglot-editor-root .dg-status{font-size:12px;color:#64748b;min-height:18px;}
#deepglot-editor-banner{position:fixed;left:24px;bottom:24px;z-index:2147483647;max-width:420px;background:#111827;color:#fff;padding:12px 14px;border-radius:12px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:13px;box-shadow:0 20px 60px rgba(15,23,42,.2);}
        '));

        $bootstrap = $doc->createElement('script');
        $bootstrap->appendChild($doc->createTextNode($this->getEditorBootstrapScript()));

        $parent = $doc->getElementsByTagName('body')->item(0);

        if (!$parent instanceof \DOMElement) {
            $parent = $doc->documentElement;
        }

        if ($parent instanceof \DOMElement) {
            $parent->appendChild($style);
            $parent->appendChild($script);
            $parent->appendChild($bootstrap);
        }
    }

    private function getEditorBootstrapScript(): string
    {
        return <<<'JS'
(function () {
  const manifestNode = document.getElementById("deepglot-editor-manifest");
  if (!manifestNode) return;

  let manifest;
  try {
    manifest = JSON.parse(manifestNode.textContent || "{}");
  } catch {
    return;
  }

  const { apiBaseUrl, projectId, token, requestUrl, segments = [] } = manifest;
  if (!apiBaseUrl || !projectId || !token) return;

  const verifyUrl = `${apiBaseUrl}/projects/${encodeURIComponent(projectId)}/editor-sessions/verify?token=${encodeURIComponent(token)}`;
  const saveUrl = `${apiBaseUrl}/projects/${encodeURIComponent(projectId)}/manual-translations`;
  const segmentMap = new Map(segments.map((segment) => [segment.id, segment]));
  let selectedId = null;

  const root = document.createElement("aside");
  root.id = "deepglot-editor-root";
  root.hidden = true;
  root.innerHTML = `
    <div class="dg-header">
      <p class="dg-title">Deepglot Visual Editor</p>
      <p class="dg-subtitle">Wähle einen markierten Text auf der Seite.</p>
    </div>
    <div class="dg-body">
      <label>
        Original
        <textarea id="dg-editor-source" readonly></textarea>
      </label>
      <label>
        Übersetzung
        <textarea id="dg-editor-translation"></textarea>
      </label>
      <div class="dg-actions">
        <button type="button" class="dg-secondary" id="dg-editor-close">Schließen</button>
        <button type="button" class="dg-primary" id="dg-editor-save">Speichern</button>
      </div>
      <div class="dg-status" id="dg-editor-status"></div>
    </div>
  `;
  document.body.appendChild(root);

  const sourceField = root.querySelector("#dg-editor-source");
  const translationField = root.querySelector("#dg-editor-translation");
  const saveButton = root.querySelector("#dg-editor-save");
  const closeButton = root.querySelector("#dg-editor-close");
  const statusNode = root.querySelector("#dg-editor-status");

  function setStatus(message) {
    if (statusNode) statusNode.textContent = message;
  }

  function clearSelection() {
    document
      .querySelectorAll("[data-deepglot-segment-id][data-deepglot-selected='true']")
      .forEach((node) => node.setAttribute("data-deepglot-selected", "false"));
    selectedId = null;
  }

  function selectSegment(segmentId) {
    const segment = segmentMap.get(segmentId);
    if (!segment || !sourceField || !translationField) return;

    clearSelection();
    selectedId = segmentId;
    const node = document.querySelector(`[data-deepglot-segment-id="${segmentId}"]`);
    if (node) node.setAttribute("data-deepglot-selected", "true");

    sourceField.value = segment.originalText || "";
    translationField.value = segment.translatedText || "";
    root.hidden = false;
    setStatus("");
  }

  closeButton?.addEventListener("click", () => {
    clearSelection();
    root.hidden = true;
  });

  saveButton?.addEventListener("click", async () => {
    if (!selectedId || !translationField) return;

    const segment = segmentMap.get(selectedId);
    if (!segment) return;

    saveButton.disabled = true;
    setStatus("Speichert …");

    try {
      const response = await fetch(saveUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token,
          originalText: segment.originalText,
          translatedText: translationField.value,
          langFrom: segment.langFrom,
          langTo: segment.langTo,
          requestUrl: requestUrl || window.location.href,
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "Speichern fehlgeschlagen.");
      }

      segment.translatedText = translationField.value;
      const node = document.querySelector(`[data-deepglot-segment-id="${selectedId}"]`);
      if (node) {
        node.textContent = translationField.value;
      }
      setStatus("Gespeichert.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Speichern fehlgeschlagen.");
    } finally {
      saveButton.disabled = false;
    }
  });

  fetch(verifyUrl, { credentials: "omit" })
    .then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Editor-Token ungültig.");
      }

      document.querySelectorAll("[data-deepglot-segment-id]").forEach((node) => {
        node.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          const segmentId = node.getAttribute("data-deepglot-segment-id");
          if (segmentId) selectSegment(segmentId);
        });
      });

      const banner = document.createElement("div");
      banner.id = "deepglot-editor-banner";
      banner.textContent = "Visual Editor aktiv. Klicke auf einen markierten Text, um ihn zu bearbeiten.";
      document.body.appendChild(banner);
      window.setTimeout(() => banner.remove(), 5000);
    })
    .catch((error) => {
      const banner = document.createElement("div");
      banner.id = "deepglot-editor-banner";
      banner.textContent = error instanceof Error ? error.message : "Editor konnte nicht gestartet werden.";
      document.body.appendChild(banner);
    });
})();
JS;
    }
}
