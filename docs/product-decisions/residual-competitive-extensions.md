# Residual competitive extensions (#320)

Status: current PM product decision, 2026-10-09. This record assesses the
five candidates in [issue #320](https://github.com/ostheimer/deepglot/issues/320)
against shipped Deepglot behavior and sets explicit gates for reconsidering
deferred work. The gates introduced here are new PM decisions; they are not
prior owner commitments. Competitor documentation is evidence of competitor
features, not evidence of customer demand or a requirement for Deepglot.

## Decision matrix

| Candidate | Decision and shipped boundary | Owner, value, architecture, privacy and cost | Reconsideration gate |
|---|---|---|---|
| Website discovery and pretranslation | **Keep the existing controlled sitemap sync; defer a permanent crawler, additional discovery and bulk/scheduled pretranslation.** The WordPress plugin already offers administrator-previewed and confirmed sitemap URL synchronization from a fixed snapshot, bounded batches and page opens, backpressure, pause/resume/cancel and failed-only retry. It is explicitly not a permanent crawler. This is distinct from discovering arbitrary missing URLs or proactively spending quota to pretranslate them. | **Owner:** URL inventory operations remain with [#263](https://github.com/ostheimer/deepglot/issues/263); this decision does not narrow its acceptance criteria. **Value:** current controlled sync supports administrators processing known target URLs. **Architecture/security:** discovery needs origin and robots rules, SSRF-safe fetches, bounded redirects, durable/resumable state and error reporting. **Cost:** pretranslation must show a per-language word/quota estimate, require a fresh operator confirmation, honor quotas and bound concurrency/retries. No schedule is authorized here. | Reconsider only when **three qualified WordPress customers** request discovery or pretranslation and provide representative sitemap/site fixtures, and a comparison against the current sitemap inventory quantifies the relevant URLs it misses. Any proposal must first meet #263's safety, cost-preview, quota, retry and ownership requirements. |
| Visual-editor metadata and browser extension | **Defer a dedicated editable SEO-metadata surface; reject a browser-extension workflow for the current product.** The visual editor is shipped (#58), and automatic title, meta, Open Graph and accessibility text translation is documented. Those shipped capabilities do not imply an editor for arbitrary head metadata. The central workspace remains owned by [#257](https://github.com/ostheimer/deepglot/issues/257); this decision does not claim its remaining scope is complete. | **Owner:** #257 for a future in-product editing workflow; #58 is the delivered visual-editor boundary. **Value:** a distinct metadata editor could help teams who need to edit SEO text in context. **Architecture/security:** it would need permission-checked persistence and cache invalidation; an extension would add browser permissions, supported-browser commitments, token/session handling and distribution maintenance. **Cost/privacy:** no extra provider call is needed for manual edits, but an extension expands the credential and website access surface. | Reconsider the metadata surface after **three qualified customer requests in a rolling 90-day period** identify a concrete metadata-editing task the visual editor and workspace cannot do, and provide representative metadata fixtures. An extension remains rejected unless those same users demonstrate a restricted/private environment that cannot be served by a supported in-product workflow; any proposal must specify browsers, permissions, token lifetime and persistence before implementation. |
| RSS, feeds, SVG and specialized formats | **Keep RSS/Atom title translation; defer full feed-content and SVG text translation.** The plugin documents human-readable RSS and Atom feed titles as translated in v0.12.8. This is not a claim that every feed field or XML format is localized. Text-PDF work remains delivered under #58; locale-specific media replacement remains separate. | **Owner:** WordPress plugin format behavior; any new scope needs a separately approved issue. **Value:** full feeds may help customers whose feeds are an active distribution channel; SVG text may matter for diagrams or logos. **Architecture/security:** XML and SVG support require a defined parser and source of truth, entity and external-resource defenses, safe output rules, caching/index behavior, fallback semantics and reproducible fixtures. **Cost:** new translatable text can consume provider quota and enlarge cache/storage use. | Reconsider each format independently after **three qualified customers per format** provide representative feed or SVG fixtures and show that the untranslated content blocks a real workflow. Before implementation, publish the supported format/element contract and pass fixture coverage for sanitization, caching, fallback and quota accounting. |
| Country and browser analytics | **Reject country and browser breakdowns under the current privacy design.** [#258](https://github.com/ostheimer/deepglot/issues/258) delivered optional page views independent of translation requests, with explicit manager opt-in and 90-day retention. It deliberately stores no visitor IP address, user-agent string, referrer, cookie, fingerprint or persistent visitor identifier. Country/browser values are not currently part of that event design. | **Owner:** #258 defines current page-view analytics. **Value:** these dimensions might help choose target languages, but no project demand is recorded here. **Architecture/privacy:** deriving or retaining dimensions changes the data model and collection/processing disclosure; it must not be inferred or added silently. **Cost:** storage and aggregation are secondary to consent and data-minimization requirements. | Reconsider only after **three qualified customers** document a language-selection decision that current aggregate page views cannot support, and a separately reviewed design establishes data minimization, explicit informed opt-in, scoped retention/deletion, legal/product approval and independent production verification. Until every gate passes, the dimensions remain disabled and no visitor data may be collected for them. |
| Multilingual GEO / AI-visibility reporting | **Reject a combined GEO/AI-visibility marketing score; defer a Deepglot first-party report.** A competitor report or claim is not a Deepglot measurement. No validated first-party method or customer demand is documented. | **Owner:** no implementation owner is assigned; this report records a product boundary only. **Value:** a carefully bounded report might help customers understand visibility across languages. **Architecture/privacy:** a future method must name its data sources and customer authorization, avoid unrelated visitor tracking, define supported engines and uncertainty, and allow reproducible checks. **Cost:** recurring measurement, engine access and report operations need an explicit budget before launch. | Reconsider a first-party report only after **three qualified customers authorize a pilot** and a repeatable measurement protocol is independently reproduced on **at least 10 representative site/language pairs across two measurement runs**. The pilot must state supported engines, method, uncertainty, update cadence, customer authorization and operating cost. A combined or unvalidated score remains rejected. |

## Existing strategic decisions and ownership

- **Non-WordPress support (#121):** the accepted [platform-agnostic decision](platform-agnostic.md)
  remains unchanged. Deepglot stays WordPress-first; snippet, reverse proxy and
  Translation CDN implementation wait for at least three qualified
  non-WordPress customers committing to a common mode and supplying fixtures,
  traffic expectations, origin constraints and an operational owner, followed
  by the documented security, routing, cache, SEO and reliability gates. This
  #320 report does not reopen or weaken that owner decision.
- **Professional marketplace (#272):** this remains a separate open issue and
  is not closed or completed here. Closed [#122](https://github.com/ostheimer/deepglot/issues/122)
  delivered member-based assignment and review states; its owner explicitly
  left external marketplace/payment out of scope and retained export → vendor
  → import as the handoff. [#272](https://github.com/ostheimer/deepglot/issues/272)
  separately requires quote scope, order states and immutable snapshots,
  least-privilege vendor access, payment/tax/dispute/failure ownership, and
  legal, privacy, billing and production acceptance. No quantitative demand
  gate or approval to build a marketplace is recorded in #272; this document
  does not invent an owner commitment or claim those implementation criteria
  are satisfied.

## Evidence and public-claim boundaries

- #58 records the shipped visual editor, translation memory, text-PDF,
  multilingual sitemap and AMP work; Translation CDN remains governed by
  #121. [#120](https://github.com/ostheimer/deepglot/issues/120) records the
  shipped dynamic-content layer. These are not reopened as missing features.
- #258 and the README define opt-in page views and their privacy boundary.
  Existing page-view data must not be relabeled as translation or visitor
  demographics.
- Current public product documentation must distinguish shipped behavior from
  deferred scope using the boundaries above. A competitor's feature or claim
  alone does not justify a Deepglot availability or performance claim.
- If a future candidate passes its gate, scope it under its existing owner
  issue where that issue's scope fits, or create a separately approved linked
  issue. Do not silently transfer ownership or acceptance criteria.

The official [Weglot URL-management documentation](https://support.weglot.com/article/286-how-can-i-manage-my-urls-and-generate-the-translations),
[Visual Editor documentation](https://support.weglot.com/article/409-how-to-use-the-visual-editor),
[page-view statistics documentation](https://support.weglot.com/article/434-how-to-get-statistics-about-page-views),
[import/export documentation](https://support.weglot.com/article/432-what-can-we-export-import),
and [Multilingual GEO Report page](https://www.weglot.com/multilingual-geo-report)
were checked on 2026-10-09. They support competitor capability comparisons
only; they do not establish Deepglot demand, performance, or product scope.
