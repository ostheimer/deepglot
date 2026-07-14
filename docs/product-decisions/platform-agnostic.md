# Platform-agnostic delivery decision

Status: accepted product decision, 2026-07-13

Issue #121 asks whether Deepglot should add a Universal JavaScript snippet and
an SEO-grade Reverse proxy for non-WordPress sites. The Translation CDN item
in issue #58 is the same infrastructure decision as the reverse-proxy path.

Decision: **defer implementation**.

Deepglot remains WordPress-first. There is no validated customer demand that
justifies placing customer production traffic behind a new proxy, operating a
global cache, or supporting an SEO-limited browser-only integration. Neither
mode exists today, and both must not be advertised as available. The public
setup flow and developer reference must continue to direct customers to the
WordPress plugin and state that non-WordPress support is unavailable.

This is a deliberate resolution, not an unbounded backlog promise. Building
either mode before demand is validated would expand the security, reliability,
support, and data-processing surface while the supported WordPress product is
still being proven.

## Reconsideration gate

Reopen the decision only after at least three qualified non-WordPress customers
commit to a common integration mode and can provide representative fixtures,
traffic expectations, origin constraints, and an operational owner. A generic
mailing-list signup or an internal feature preference does not meet this gate.

If that gate is met, start with the smallest mode supported by the evidence:

- The Universal JavaScript snippet is appropriate for private applications or
  content where crawlability is not required. It needs an origin-locked public
  site token, quota and rate limits, MutationObserver batching, cache-first
  behavior, and an explicit warning that translated content is client-rendered.
- The Reverse proxy is appropriate only when customers require
  server-rendered crawlable HTML. It needs origin allowlisting, SSRF and DNS
  rebinding protection, safe redirects, link/canonical/hreflang rewriting,
  cache invalidation, tenant isolation, and a documented bypass and rollback.
- A Translation CDN is not a separate shortcut. It is the caching and delivery
  layer of the reverse proxy and inherits all of its release gates.

## Release gates for a future implementation

No non-WordPress mode may be called supported until it has:

- contract tests for translation, routing, language detection, failure modes,
  quota and rate limits, and cache invalidation;
- integration tests using representative HTML, dynamic DOM updates, redirects,
  large pages, and origin failures;
- explicit tenant isolation, credential rotation, deletion, and audit behavior;
- SSRF, DNS-rebinding, open-redirect, script-injection, and cache-poisoning
  coverage appropriate to the selected mode;
- a load test with published capacity and timeout budgets;
- an independent security review and an incident rollback runbook;
- public documentation that distinguishes SEO-grade proxy delivery from the
  client-rendered snippet and does not imply parity between them.

Until the reconsideration gate is met, maintenance work is limited to keeping
the current unsupported status accurate and preventing dead CDN or snippet
URLs from reappearing in the product.
