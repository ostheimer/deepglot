# Open issue resolution record

Snapshot: 2026-07-13. This record covers every issue that was open when the
work began. It distinguishes code that is implemented and tested from explicit
product decisions. It is an audit aid, not a replacement for the linked tests,
GitHub discussion, deployment evidence, or legal approval.

| Issue | Disposition | Evidence and boundary |
|---|---|---|
| #214 | Implemented and tested | Memory/Prisma store parity, concurrent PostgreSQL reservations, plan-derived velocity cap, and route wiring guard. |
| #191 | Implemented and tested | Read-only Plan schema acceptance checks all canonical enum values and rejects legacy `PROFESSIONAL` rows; shared Development/Preview Neon was checked without writes. |
| #172 | Accepted defer decision | Narrow DPP localization brief, non-goals, dependencies, evidence gate, and a guard against premature compliance claims. |
| #169 | Accepted defer decision | Agent skills remain unavailable until the REST surface and a supported execution surface meet the documented release checklist. |
| #168 | Accepted defer decision | Official SDK/CLI remains unavailable until the REST contract has two stable releases and concrete language/runtime demand. |
| #167 | Accepted defer decision | MCP remains unavailable until public API prerequisites and a two-user Demand gate are met. |
| #166 | Implemented and tested | Shared Problem Details contract across public/plugin APIs, legacy error compatibility, and WordPress client coverage. |
| #161 | Implemented and tested | Persistent translation idempotency, exact replay, conflict handling, concurrency coalescing, cleanup, and real PostgreSQL integration. |
| #159 | Owner/legal approval required | Product-current legal drafts, route guards, current operator data, and a maintenance checklist exist. The issue must not be closed without explicit owner approval and qualified review where needed. |
| #158 | Implemented and tested | Source-backed public API/WordPress reference, examples, auth/failure semantics, webhook contract, lifecycle policy, locale routes, and anti-drift tests. |
| #124 | Tracking resolution | Close only after the child issues #57, #58, #121, and #122 have their implementation or accepted-decision evidence linked in GitHub. |
| #122 | Implemented and tested | Tenant/language-scoped assignment and review state machine, filters, pagination, dashboard, member cleanup, approval invalidation, and PostgreSQL coverage. Marketplace/payment is explicitly deferred; export/import remains the external-vendor handoff. |
| #121 | Accepted defer decision | WordPress-first scope remains. A Universal JavaScript snippet, reverse proxy, and Translation CDN stay unavailable until the three-customer Demand gate and security/reliability release gates are met. |
| #58 | Implemented and tested | Visual-editor persistence, organization Translation Memory from approved segments, existing glossary dashboard, bounded text-PDF translation, multilingual sitemap, and AMP pipeline verification. Translation CDN follows the #121 defer decision. |
| #57 | Implemented and tested | Independent switcher instances, persisted migration, visual selector placement, versioned templates, PHP/JS WordPress fixtures, and unique ARIA state. |

## Validation layers

- Node unit and source-wiring tests cover state machines, contracts, guards,
  localization, public documentation, and deterministic failure behavior.
- Disposable PostgreSQL 16 integration tests cover atomic idempotency, rate
  limiting, tenant boundaries, editor persistence, Translation Memory, human
  workflow cleanup, and PDF usage accounting.
- The complete WordPress PHP and JavaScript suite covers switcher instances,
  visual placement, AMP behavior, sitemap output, Problem Details fallback,
  dynamic content, routing, cache safety, and version consistency.
- Playwright covers public docs/legal routes and the authenticated visual,
  human-review, and PDF flows. Browser checks run against a local build and
  disposable database; they do not modify production.

## External verification boundaries

The local branch does not deploy or mutate a live WordPress site. A future
non-production WordPress acceptance should exercise the real visual editor,
switcher placement, AMP plugin toggle, sitemap/robots response headers, and a
configured subdomain with DNS/TLS. Those deployment checks are separate from
the deterministic repository acceptance and must never be run against a live
customer site without an explicit target and authorization.
