<?php

namespace Deepglot\Frontend;

use Deepglot\Config\Options;
use Deepglot\Support\SiteRouting;
use Deepglot\Support\UrlLanguageResolver;

/**
 * Captures the WordPress HTML output, translates text nodes via the
 * Deepglot API, rewrites internal links and injects hreflang tags.
 */
class OutputBuffer
{
    private Options $options;
    private UrlLanguageResolver $resolver;
    private HtmlTranslator $translator;
    private LinkRewriter $linkRewriter;
    private HreflangInjector $hreflangInjector;
    private RequestRouter $router;
    private SiteRouting $routing;

    public function __construct(
        Options $options,
        UrlLanguageResolver $resolver,
        HtmlTranslator $translator,
        LinkRewriter $linkRewriter,
        HreflangInjector $hreflangInjector,
        RequestRouter $router,
        SiteRouting $routing
    ) {
        $this->options          = $options;
        $this->resolver         = $resolver;
        $this->translator       = $translator;
        $this->linkRewriter     = $linkRewriter;
        $this->hreflangInjector = $hreflangInjector;
        $this->router           = $router;
        $this->routing          = $routing;
    }

    public function register(): void
    {
        add_action('template_redirect', [$this, 'startBuffer'], 0);
    }

    public function startBuffer(): void
    {
        $targetLanguage = $this->detectTargetLanguage();

        if ($targetLanguage === null) {
            return;
        }

        ob_start(function (string $html) use ($targetLanguage): string {
            return $this->process($html, $targetLanguage);
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

        // Step 1: translate text nodes.
        if ($editorMode) {
            $translated = $this->translator->translateForEditor($html, $targetLanguage);
            $html = $translated['html'];
            $editorSegments = $translated['segments'];
        } else {
            $html = $this->translator->translate($html, $targetLanguage);
        }

        // Steps 2 + 3 need the DOM, so load once.
        $doc = $this->loadDocument($html);

        // Step 2: rewrite internal links to include language prefix.
        $this->linkRewriter->rewrite($doc, $targetLanguage);

        // Step 3: inject hreflang tags.
        // Use the original (pre-rewrite) REQUEST_URI to get the canonical path.
        $rawUri        = isset($_SERVER['REQUEST_URI']) ? (string) $_SERVER['REQUEST_URI'] : '/';
        $canonicalPath = $this->routing->getCanonicalPath($rawUri);
        $this->hreflangInjector->inject($doc, $canonicalPath);

        // Step 4: add translate="no" so browser extensions don't double-translate.
        $htmlEl = $doc->getElementsByTagName('html')->item(0);

        if ($htmlEl instanceof \DOMElement && !$htmlEl->hasAttribute('translate')) {
            $htmlEl->setAttribute('translate', 'no');
        }

        if ($editorMode && !empty($editorSegments)) {
            $this->injectEditorShell($doc, $editorSegments);
        }

        return $this->saveDocument($doc);
    }

    // -------------------------------------------------------------------------

    private function detectTargetLanguage(): ?string
    {
        if (is_admin() || wp_doing_ajax() || wp_is_json_request()) {
            return null;
        }

        if (!$this->options->isEnabled() || !$this->options->isConfigured()) {
            return null;
        }

        if (headers_sent()) {
            return null;
        }

        // The RequestRouter already stripped the language prefix from REQUEST_URI,
        // but it stored the detected language for us.
        $detected = $this->router->getCurrentLanguage();

        if ($detected !== null) {
            return $detected;
        }

        // Fallback: re-detect from the original URI (before REQUEST_URI was rewritten).
        // The router stores the original URI in a request attribute; if not available,
        // detect from the still-current REQUEST_URI.
        $uri = isset($_SERVER['REQUEST_URI']) ? (string) $_SERVER['REQUEST_URI'] : '/';
        $host = isset($_SERVER['HTTP_HOST']) ? (string) $_SERVER['HTTP_HOST'] : '';
        return $this->routing->detectLanguage($uri, $host);
    }

    private function loadDocument(string $html): \DOMDocument
    {
        $doc = new \DOMDocument('1.0', 'UTF-8');

        libxml_use_internal_errors(true);
        $doc->loadHTML(
            '<?xml encoding="UTF-8">' . $html,
            LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD | LIBXML_NOWARNING | LIBXML_NOERROR
        );
        libxml_clear_errors();

        return $doc;
    }

    private function saveDocument(\DOMDocument $doc): string
    {
        $html = $doc->saveHTML();

        if ($html === false) {
            return '';
        }

        return str_replace('<?xml encoding="UTF-8">', '', $html);
    }

    private function isEditorMode(): bool
    {
        return isset($_GET['deepglot_editor']) && isset($_GET['deepglot_editor_token']) && isset($_GET['deepglot_editor_project']);
    }

    /**
     * @param array<int, array<string, string>> $segments
     */
    private function injectEditorShell(\DOMDocument $doc, array $segments): void
    {
        $projectId = isset($_GET['deepglot_editor_project']) ? sanitize_text_field((string) $_GET['deepglot_editor_project']) : '';
        $token = isset($_GET['deepglot_editor_token']) ? sanitize_text_field((string) $_GET['deepglot_editor_token']) : '';

        if ($projectId === '' || $token === '') {
            return;
        }

        $apiBaseUrl = rtrim($this->options->getApiBaseUrl(), '/');
        $manifestJson = wp_json_encode([
            'apiBaseUrl' => $apiBaseUrl,
            'projectId' => $projectId,
            'token' => $token,
            'requestUrl' => home_url(add_query_arg([], isset($_SERVER['REQUEST_URI']) ? (string) $_SERVER['REQUEST_URI'] : '/')),
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
.deepglot-editor-segment:hover{outline:1px dashed #4f46e5;background:rgba(79,70,229,.08);}
.deepglot-editor-segment[data-deepglot-selected="true"]{outline:2px solid #4f46e5;background:rgba(79,70,229,.12);}
#deepglot-editor-root{position:fixed;top:24px;right:24px;z-index:2147483647;width:360px;max-width:calc(100vw - 32px);background:#fff;border:1px solid #dbe4ff;border-radius:16px;box-shadow:0 24px 80px rgba(15,23,42,.18);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#111827;}
#deepglot-editor-root[hidden]{display:none;}
#deepglot-editor-root .dg-header{padding:16px 18px;border-bottom:1px solid #eef2ff;background:linear-gradient(135deg,#eef2ff,#ffffff);}
#deepglot-editor-root .dg-title{font-size:14px;font-weight:700;margin:0 0 4px;}
#deepglot-editor-root .dg-subtitle{font-size:12px;color:#64748b;margin:0;}
#deepglot-editor-root .dg-body{padding:16px 18px;display:grid;gap:12px;}
#deepglot-editor-root label{display:grid;gap:6px;font-size:12px;font-weight:600;color:#475569;}
#deepglot-editor-root textarea,#deepglot-editor-root input{width:100%;border:1px solid #dbe4ff;border-radius:10px;padding:10px 12px;font:inherit;color:#111827;background:#fff;}
#deepglot-editor-root textarea{min-height:120px;resize:vertical;}
#deepglot-editor-root .dg-actions{display:flex;justify-content:space-between;gap:10px;}
#deepglot-editor-root button{appearance:none;border:none;border-radius:10px;padding:10px 14px;font:inherit;font-weight:600;cursor:pointer;}
#deepglot-editor-root .dg-primary{background:#4f46e5;color:#fff;}
#deepglot-editor-root .dg-secondary{background:#eef2ff;color:#3730a3;}
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
