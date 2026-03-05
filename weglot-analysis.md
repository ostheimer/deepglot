# Weglot WordPress Plugin – Technische Analyse & Nachbau-Planung

> Analysiert: Plugin Version 5.3 (Stand: März 2026)  
> Ziel: Grundlage für ein eigenes WordPress-Übersetzungs-Plugin ohne Cloud-Lock-in

---

## 1. Architektur-Überblick

Weglot arbeitet **nicht** mit duplizierten Posts in der WP-Datenbank (wie WPML), sondern fängt den fertigen HTML-Output über PHP's Output Buffering ab und übersetzt on-the-fly.

```
WordPress rendert HTML
        ↓
ob_start() fängt Output ab
        ↓
HTML → Parser → Text-Strings extrahieren
        ↓
Strings → Weglot Cloud API (DeepL/Google/OpenAI)
        ↓
Übersetzter HTML → Links ersetzen → Switcher injizieren
        ↓
Ausgabe an Browser
```

---

## 2. Plugin-Struktur

```
weglot/
├── weglot.php                  # Entry point, Konstanten
├── bootstrap.php               # Service Container initialisieren
├── weglot-functions.php        # Public helper functions
├── weglot-autoload.php
├── src/
│   ├── actions/
│   │   ├── front/
│   │   │   ├── class-translate-page-weglot.php   # ← Haupt-Hook-Registrierung
│   │   │   ├── class-front-enqueue-weglot.php
│   │   │   ├── class-search-weglot.php
│   │   │   └── class-redirect-comment.php
│   │   ├── admin/
│   │   └── rest/
│   ├── services/
│   │   ├── class-translate-service-weglot.php    # ← ob_start + Orchestrierung
│   │   ├── class-parser-service-weglot.php       # ← HTML Parser
│   │   ├── class-request-url-service-weglot.php  # ← URL/Sprach-Erkennung
│   │   ├── class-replace-url-service-weglot.php  # ← Link-Replacement
│   │   ├── class-redirect-service-weglot.php     # ← Auto-Redirect
│   │   ├── class-href-lang-service-weglot.php    # ← SEO hreflang
│   │   ├── class-generate-switcher-service-weglot.php
│   │   ├── class-language-service-weglot.php
│   │   ├── class-option-service-weglot.php
│   │   ├── class-email-translate-service-weglot.php  # WooCommerce Mails
│   │   └── class-pdf-translate-service-weglot.php
│   ├── domcheckers/            # Regeln welche DOM-Elemente übersetzt werden
│   ├── domlisteners/
│   ├── helpers/
│   ├── models/
│   ├── third/                  # Kompatibilität: Yoast, WP Rocket, WP Engine etc.
│   └── widgets/
├── vendor/                     # Weglot PHP Client Library
└── blocks/                     # Gutenberg Blocks (Switcher Widget)
```

---

## 3. Kern-Mechanismus: Output Buffer

**Datei:** `src/services/class-translate-service-weglot.php`

```php
public function weglot_translate() {
    $is_wp_engine = apply_filters('weglot_is_wp_engine_hosting', false);

    if ($is_wp_engine) {
        // WP Engine hat eigenen Output-Hook
        add_filter('final_output', array($this, 'weglot_treat_page'), 999);
    } else {
        ob_start(array($this, 'weglot_treat_page'));
    }
}
```

Die Callback-Funktion `weglot_treat_page($content)` übernimmt den gesamten HTML-String und gibt den übersetzten HTML zurück.

### Content-Type Detection in `weglot_treat_page()`

```php
$type = (Helper_Json_Inline_Weglot::is_json($content)) ? 'json' : 'html';
if ('json' !== $type) {
    $type = (Helper_Json_Inline_Weglot::is_xml($content)) ? 'xml' : 'html';
}
```

→ Unterstützt HTML-Seiten, REST-API JSON-Responses und XML-Sitemaps.

### Ablauf pro Request:

1. Sprache aus URL ermitteln (`Request_Url_Service`)
2. Content-Typ erkennen (html/json/xml)
3. Prüfen ob Seite übersetzt werden soll (Exclusion-Liste, AJAX, Admin, Bot-Detection)
4. Parser aufrufen → Strings extrahieren
5. API-Call an `api.weglot.com/translate`
6. Links im DOM ersetzen (`replace_link_in_dom`)
7. Language Switcher injizieren (`generate_switcher_from_dom`)
8. `translate="no"` auf `<html>` setzen (verhindert Browser-Auto-Translate)

---

## 4. URL-Routing (ohne WordPress Rewrite Rules!)

**Datei:** `src/actions/front/class-translate-page-weglot.php`

Weglot manipuliert direkt `$_SERVER['REQUEST_URI']`, sodass WordPress die Seite normal rendert:

```php
// /de/about → WordPress sieht /about und rendert normal
// Weglot übersetzt dann den fertigen Output
$_SERVER['REQUEST_URI'] = sanitize_url(
    $this->request_url_services->get_weglot_url()->getPathPrefix() .
    $this->request_url_services->get_weglot_url()->getPathAndQuery()
);
```

→ **Kein** `add_rewrite_rule()` nötig! WordPress weiß nichts von den Sprachpräfixen.

### Hook-Registrierung

```php
public function hooks() {
    add_action('init', array($this, 'weglot_init'), 11);
    add_action('wp_head', array($this, 'weglot_href_lang'));
    add_action('wp_head', array($this, 'weglot_custom_settings'));
    add_action('wp_enqueue_scripts', array($this, 'enqueue_switcher_templatefile'));
    add_action('wp_head', array($this, 'weglot_dynamics'));
}
```

---

## 5. Service-Architektur

Alle Services werden via eigenem Service Container instanziiert (`weglot_get_service(ClassName::class)`).

| Service | Aufgabe |
|---|---|
| `Translate_Service_Weglot` | ob_start, Orchestrierung des gesamten Ablaufs |
| `Parser_Service_Weglot` | HTML parsing via simplehtmldom, DOM-Checker |
| `Request_Url_Service_Weglot` | Sprache aus URL extrahieren, URL-Objekte erstellen |
| `Replace_Url_Service_Weglot` | Links in HTML/JSON/XML auf Sprachversion anpassen |
| `Redirect_Service_Weglot` | Browser-Language Auto-Redirect |
| `Href_Lang_Service_Weglot` | SEO hreflang Tags generieren |
| `Generate_Switcher_Service_Weglot` | Language Switcher HTML generieren + in DOM injizieren |
| `Language_Service_Weglot` | Original- und Zielsprachen verwalten |
| `Option_Service_Weglot` | Plugin-Einstellungen (API Key, Exclusions etc.) |
| `Email_Translate_Service_Weglot` | WooCommerce E-Mails übersetzen |
| `Pdf_Translate_Service_Weglot` | PDF-Übersetzung |
| `Dom_Checkers_Service_Weglot` | Regeln welche DOM-Elemente übersetzt werden |
| `Regex_Checkers_Service_Weglot` | Regex-basierte Ausschlussregeln |

---

## 6. Edge-Cases die Weglot behandelt

| Problem | Lösung |
|---|---|
| WP Engine Hosting | `final_output` Filter statt `ob_start` |
| AJAX-Requests | Referer-URL analysieren für Sprach-Ermittlung |
| WooCommerce Cart AJAX | Eigene `force_translate_cart()` Logik |
| 404 Pages | Nicht übersetzen wenn in Exclusion-Liste |
| Vue.js Attribute | Vor Parsing escapen, nach Übersetzung restoren |
| Elementor Preview | `elementor-preview` GET-Parameter → kein Translate |
| Bot-Traffic | Matomo DeviceDetector → Bots werden nicht übersetzt |
| JSON-Responses (REST API) | Eigene JSON-Behandlung mit `replace_link_in_json()` |
| XML-Sitemaps | Eigene XML-Behandlung mit `replace_link_in_xml()` |
| WP Rocket / Caching | Third-Party Kompatibilitäts-Modul |
| Canonical URLs | Canonical-Tag wird analysiert und ggf. korrigiert |
| RTL-Sprachen | `$GLOBALS['text_direction']` wird gesetzt |
| Trailing Slash | Optional: manage_trailing_slash Filter |
| Custom Redirects | Pro-Feature: URL-spezifische Sprach-Redirects |

### AJAX-Exclusion-Liste (hartcodiert)

Weglot schließt folgende WordPress/Plugin-Actions vom Übersetzen aus:

```php
array(
    'add-menu-item',           // WP Core
    'query-attachments',       // WP Core
    'elementor_ajax',          // Elementor
    'et_fb_ajax_save',         // Divi Builder
    'generate_wpo_wcpdf',      // WooCommerce PDF
    'wpestate_ajax_check_booking_valability', // WP Estate
    // ... weitere
)
```

---

## 7. API-Kommunikation

**Endpoint:** `POST https://api.weglot.com/translate?api_key=XXX`

**Request Body:**
```json
{
    "l_from": "en",
    "l_to": "de",
    "title": "Page Title",
    "request_url": "https://example.com/about/",
    "words": [
        {"t": 1, "w": "This is a blue car"},
        {"t": 1, "w": "Contact Us"}
    ]
}
```

**Word Types (t):**
- `1` = Text
- `2` = Value/Attribute (z.B. `alt`, `placeholder`, `title`)

Weglot schickt **alle Strings einer Seite in einem einzigen API-Call** – das minimiert die Latenz.

---

## 8. Fronted: Switcher & JavaScript

Weglot liefert einen JavaScript-Bundle (`weglot.min.js` von CDN) der:
- Den Language Switcher rendert (Template-basiert, von Weglot-CDN geladen)
- Dynamische Inhalte (AJAX-geladene) nachträglich übersetzt (`dynamics` Feature)
- Browser-Sprache erkennt für Auto-Redirect

Settings werden als JSON im HTML eingebettet:
```html
<script type="application/json" id="weglot-data">
    {"current_language":"de","switcher_links":{...},...}
</script>
```

---

## 9. Vergleich: Weglot vs. TranslatePress vs. Loco Translate

| Feature | **Weglot** | **TranslatePress** | **Loco Translate** |
|---|---|---|---|
| **Übersetzungs-Ansatz** | `ob_start` + Cloud API | `ob_start` + lokale DB | Gettext PO/MO Dateien |
| **Was wird übersetzt** | Content + Theme + Plugins | Content + Theme + Plugins | Nur Plugin/Theme-Strings |
| **Übersetzungen gespeichert** | Weglot Cloud ☁️ | WP-Datenbank lokal | `.po` / `.mo` Dateien |
| **URL-Routing** | `$_SERVER` Manipulation | `add_rewrite_rule()` | Kein Routing |
| **Lock-in Risiko** | ⚠️ Hoch | ✅ Gering | ✅ Keiner |
| **API-Abhängigkeit** | Immer (Pflicht) | Optional (einmalig für Maschinenübersetzung) | Keine |
| **Preis-Modell** | Recurring SaaS | Einmalzahlung | Kostenlos |
| **Performance** | ob_start + API-Latenz | ob_start + DB-Lookup | Kein Overhead |
| **Automatische Übersetzung** | ✅ AI (DeepL/Google/OpenAI) | ✅ Optional via API | ❌ Manuell |
| **WooCommerce** | ✅ inkl. Mails | ✅ | ❌ |
| **Anwendungsfall** | Schnell, managed | Volle Kontrolle | Nur Theme/Plugin-Strings |

**Wichtig:** Loco Translate ist kein direkter Konkurrent – es übersetzt ausschließlich `__()` / `_e()` Gettext-Strings in Plugin/Theme-Code, nicht den Seiten-Content.

---

## 10. Nachbau-Plan: Eigenes Plugin ohne Cloud-Lock-in

### Kernkomponenten (Mindestumfang MVP)

#### 10.1 Output Buffer (trivial)
```php
add_action('template_redirect', function() {
    ob_start(function($html) {
        // Übersetzungslogik
        return $translated_html;
    });
}, 0);
```

#### 10.2 HTML Parser
Weglot verwendet einen eigenen Fork von **simplehtmldom** (`weglot/simplehtmldom` auf GitHub).  
Alternativen:
- `simplehtmldom` (original, MIT-Lizenz)
- PHP `DOMDocument` (native, aber buggy mit HTML5)
- `DiDOM` (moderner, Composer-ready)
- `symfony/dom-crawler`

#### 10.3 URL-Klasse
Kernlogik:
- Sprache aus `REQUEST_URI` extrahieren (`/de/about` → `de`)
- `$_SERVER['REQUEST_URI']` auf Original-Pfad setzen
- URL-Versionen für alle Sprachen generieren
- Exclusion-URLs prüfen

#### 10.4 Übersetzungs-Backend
Statt Weglot-API direkt **DeepL API** verwenden:
- DeepL Free: 500.000 Zeichen/Monat kostenlos
- DeepL Pro: ~€5,99/Monat für 1M Zeichen
- Wesentlich günstiger als Weglot (Weglot ~€99/Monat für 200k Wörter)

```php
POST https://api-free.deepl.com/v2/translate
{
    "text": ["Hello World", "Contact"],
    "source_lang": "EN",
    "target_lang": "DE"
}
```

#### 10.5 Caching (kritisch für Performance!)
Übersetzungen **lokal speichern** – das ist der wichtigste Unterschied zu Weglot:

Option A: WordPress Transients (einfach)
```php
$cache_key = 'translation_' . md5($text . $lang_from . $lang_to);
$cached = get_transient($cache_key);
```

Option B: Custom DB-Tabelle (empfohlen für Skalierung)
```sql
CREATE TABLE wp_translations (
    id bigint(20) NOT NULL AUTO_INCREMENT,
    original_hash char(32) NOT NULL,     -- md5 des Original-Strings
    original_text longtext NOT NULL,
    lang_from varchar(10) NOT NULL,
    lang_to varchar(10) NOT NULL,
    translated_text longtext NOT NULL,
    source varchar(20) DEFAULT 'auto',   -- 'deepl', 'manual', 'openai'
    created_at datetime DEFAULT CURRENT_TIMESTAMP,
    updated_at datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY hash_langs (original_hash, lang_from, lang_to)
);
```

Option C: Redis/Object Cache (für High-Traffic-Sites)

#### 10.6 Link-Replacement
Alle internen URLs im HTML müssen auf die Sprachversion umgeschrieben werden:
- `href="/about/"` → `href="/de/about/"`
- Funktioniert für HTML, JSON (REST API) und XML (Sitemaps)

#### 10.7 hreflang Tags
```html
<link rel="alternate" hreflang="de" href="https://example.com/de/about/" />
<link rel="alternate" hreflang="en" href="https://example.com/about/" />
<link rel="alternate" hreflang="x-default" href="https://example.com/about/" />
```

#### 10.8 Language Switcher
- Shortcode: `[language_switcher]`
- Widget
- Gutenberg Block
- Automatische Injektion via DOM-Manipulation (wie Weglot)

---

## 11. Architektur-Entscheidungen für den Nachbau

### Wo Übersetzungen speichern?
→ **Custom DB-Tabelle** (Option B oben) – beste Balance aus Performance und Flexibilität

### Welche Übersetzungs-API?
→ **DeepL API** als Primary, optional OpenAI/GPT-4 für kontextsensitive Übersetzungen

### URL-Strategie?
→ **Subdirectory** (`/de/`, `/fr/`) wie Weglot – SEO-optimal, von Google empfohlen
→ Implementierung via `$_SERVER['REQUEST_URI']` Manipulation (Weglot-Ansatz) ODER `add_rewrite_rule()`

### PHP HTML Parser?
→ **DiDOM** (Composer: `imangazaliev/didom`) – moderner, aktiv gepflegt, gute Performance

### Caching-Strategie?
→ Übersetzungen nie doppelt aus der API laden: Hash des Original-Strings als Cache-Key

---

## 12. Technische Risiken & Herausforderungen

| Problem | Beschreibung | Lösung |
|---|---|---|
| **Page Builder Kompatibilität** | Elementor, Divi etc. rendern teilweise via AJAX | Separate AJAX-Handler + Referer-Analyse |
| **WooCommerce** | Cart/Checkout sind stark AJAX-lastig | Eigene Force-Translate-Logik nötig |
| **Caching-Plugins** | WP Rocket, LiteSpeed Cache cachen vor ob_start | Kompatibilitäts-Hook nötig |
| **Sitemaps** | Yoast/Rank Math Sitemaps müssen auch übersetzt werden | XML-Handler wie bei Weglot |
| **REST API** | JSON-Responses für Headless WP / Gutenberg | JSON-Handler |
| **Performance** | ob_start + DB-Lookups auf jeder Seite | Aggressives Caching, evtl. Redis |
| **HTML-Encoding** | Sonderzeichen in verschiedenen Kontexten | Sorgfältiges En-/Decoding |
| **Vue.js / React** | Dynamische Inhalte nach JS-Rendering | MutationObserver im Frontend (wie Weglot Dynamics) |

---

## 13. Mögliche Erweiterungen (Post-MVP)

- **Visueller Editor**: Übersetzungen direkt auf der Live-Site bearbeiten
- **Glossar**: Bestimmte Begriffe nie übersetzen (z.B. Markenname)
- **Manuelle Übersetzungen**: API-Übersetzung als Basis, manuell korrigierbar
- **Import/Export**: Übersetzungen als CSV/PO exportieren
- **Subdomain-Support**: `de.example.com` statt `example.com/de/`
- **WooCommerce E-Mails**: Transaktionsmails in Sprache des Kunden
- **PDF-Übersetzung**: Wie Weglot's `Pdf_Translate_Service`
- **Browser-Language Auto-Redirect**: Cookies + Accept-Language Header

---

## 14. Nächste Schritte für Claude Code

1. **Plugin-Grundgerüst** aufsetzen (`plugin.php`, Autoloader, Service Container)
2. **URL-Klasse** implementieren (Sprache aus URL, `$_SERVER` Manipulation)
3. **Output Buffer** + minimaler HTML-Parser
4. **DB-Tabelle** für Übersetzungs-Cache anlegen (`wpdb` Migration)
5. **DeepL API Integration** (HTTP-Client, Batch-Requests)
6. **Caching-Layer** (Hash-basiert, DB-Lookup vor API-Call)
7. **Link-Replacement** im HTML
8. **hreflang Tags** in `wp_head`
9. **Language Switcher** (Shortcode + Widget)
10. **Admin-Settings-Page** (Sprachen konfigurieren, API-Key, Exclusions)
11. **WooCommerce Kompatibilität** (optional, Phase 2)
12. **Caching-Plugin Kompatibilität** (WP Rocket etc., Phase 2)

---

*Quellen: Weglot WordPress Plugin v5.3 (GPL-2.0, öffentlich auf WordPress.org), Weglot Developer Documentation (developers.weglot.com)*
