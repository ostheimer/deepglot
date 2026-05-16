# Deepglot Handoff - 2026-05-14

This file captures the current project state so work can continue in a new chat without relying on previous conversation context.

## Current State

- Branch: `main`
- Latest production commit: `6e9c263` (`Per-language custom flag override for the switcher (0.7.0) (#53)`)
- WordPress plugin: version 0.7.0
- Open pull requests: none at the time this handoff was written.
- Canonical production URL: `https://deepglot.ai`
- Production validation WordPress site: `https://www.meinhaushalt.at`

## Completed Since Last Handoff (2026-05-06 → 2026-05-14)

### Translation engine
- Switched default OpenAI translation model from `gpt-5.5` to `gpt-5-mini` (15× cost reduction, PR #40).
- Added Gemini translation provider (`gemini-3.1-flash-lite-preview`) with automatic 429/5xx fallback chain (PR #41). New env vars: `GEMINI_API_KEY`, `GEMINI_TRANSLATION_MODEL`, `GEMINI_BASE_URL`, `TRANSLATION_FALLBACK_PROVIDERS`.
- Added accessibility attribute translation: `<img alt>`, `aria-label`, `placeholder`, submit button copy (PR #42).

### WordPress plugin (v0.2.0 → v0.7.0)
- v0.2.0: Admin UI for language switcher — list/dropdown style, four flag finishes, drag-and-drop language order, scoped custom CSS, `applyRuntimeConfig` switcher sub-object.
- v0.3.0: Weglot-parity switcher with `<aside>`, JS-free CSS dropdown, ARIA (`aria-expanded`, `aria-haspopup`), `switcher_position` option (inline / fixed-bottom-right / fixed-bottom-left / fixed-top-right / fixed-top-left), auto-redirect marker.
- v0.4.0: WP nav-menu integration — place switcher in any registered menu (Appearance → Menus), dropdown and hide-current modifiers, proper hierarchy inheritance.
- v0.5.0: Gutenberg block `deepglot/switcher` (server-rendered, alignment support) + classic WP_Widget.
- v0.5.1: Bug fix — switcher active language (inject RequestRouter before URL strip) + skip plugin-owned links in link rewriter via `data-deepglot-no-translate`.
- v0.5.2: Bug fix — gate `aria-expanded` behind dropdown check; list-style switchers no longer claim expandability to assistive tech.
- v0.6.0: Responsive hide — `switcher_responsive_hide` (none|mobile|desktop) + `switcher_responsive_breakpoint` (default 768 px, clamped to [320, 1920]).
- v0.7.0: Per-language custom flag override — `switcher_custom_flags` assoc array (emoji string or image URL), XSS-hardened sanitisation pipeline.

### Marketing / billing fixes
- Centralised FREE word limit and soft-capped inactive subscriptions at FREE ceiling (PR #37).
- Fixed pricing slider tick alignment and hero comparison claim against real BILLING_PLANS (PR #38).
- Documented Phase 7 follow-up hardening tasks 7.13–7.15 (PR #39).

## Latest Verified Links

- `https://deepglot.ai/`
- `https://deepglot.ai/pricing`
- `https://www.deepglot.ai/api/public/status`
- `https://www.meinhaushalt.at/en/`

## Verification Status

Run these before starting a new larger implementation branch:

```bash
npm run check:docs-language
npm test
npm run test:wp
npm run lint
npx tsc --noEmit --pretty false
npm run build
npm run smoke:production
```

Run Playwright when UI behavior changes:

```bash
npm run test:e2e
```

## Known External Blocks

- Stripe live/test billing acceptance remains postponed until real Stripe live/test keys, webhook secret, and monthly price IDs are intentionally configured.
- Phase 6 subdomain live QA remains blocked until a real mapped production host is configured through `DEEPGLOT_PHASE6_SUBDOMAIN_HOST`.

## Open Roadmap Items (Phase 7)

- 7.13: Anti-drift guard for marketing copy (Playwright/lint rule for hero EUR/word tokens vs `BILLING_PLANS`).
- 7.14: Playwright slider-alignment regression test for pricing-grid ticks.
- 7.15: Stripe webhook end-to-end smoke for subscription lifecycle events.

## Recommended Next Work

- Select scope for Phase 9 or resume Stripe.
- Keep the test-first bug workflow from `AGENTS.md`.
- For future UI audits, prefer expanding `tests/e2e/full-ui-audit.spec.ts`.
- Consider two-way SaaS dashboard ↔ WordPress plugin settings sync using the `applyRuntimeConfig` hooks already wired in plugin v0.2.0–v0.7.0.
