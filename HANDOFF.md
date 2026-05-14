# Deepglot Handoff - 2026-05-14

This file captures the current project state so work can continue in a new chat without relying on previous conversation context.

## Current State

- Branch: `main`
- Latest production commit: `b84f8d38` (`Gate switcher.js aria-expanded behind dropdown check (a11y, 0.5.2) (#51)`)
- WordPress plugin version: `0.5.2`
- Open pull requests: none at the time this handoff was written.
- Canonical production URL: `https://deepglot.ai`
- Production validation WordPress site: `https://www.meinhaushalt.at`

## Completed Since Last Handoff (2026-05-06 → 2026-05-14)

### Pricing and Billing

- Replaced the static four-card pricing grid with a usage slider that drives a single live plan card through all seven tiers (PR #35).
- Reused the same `<PricingGrid>` on the marketing home page, eliminating the duplicate static pricing section (PR #36).
- Centralized the FREE word limit in `BILLING_PLANS` and introduced `getEffectiveWordsLimit` so PAST_DUE / INACTIVE / CANCELED subscriptions are soft-capped at the FREE ceiling (PR #37).
- Fixed slider tick alignment and grounded the hero comparison card in the real Pro plan data from `BILLING_PLANS` (PR #38).
- Documented Phase 7 follow-up hardening tasks 7.13–7.15 in ROADMAP.md (PR #39).

### Translation Providers

- Switched default OpenAI translation model from `gpt-5.5` to `gpt-5-mini` — approximately 15× cost reduction for web translation workloads (PR #40).
- Added Google Gemini provider (`gemini-3.1-flash-lite-preview`) and an automatic failover chain on 429/5xx errors; default chain is `gemini → openai` (PR #41).

### WordPress Plugin

- Added accessibility-attribute translation pass: `img alt`, `aria-label`, `placeholder`, submit button copy — respects `translate="no"` and `exclude_selectors` (PR #42).
- Added admin UI for the language switcher: style (list/dropdown), four flag finishes, drag-and-drop language order, scoped custom CSS (PR #44). Bumped to v0.2.0 (PR #45).
- Rewrote the language switcher to Weglot parity: semantic `<aside>`, CSS-driven dropdown via checkbox trick, ARIA, `switcher_position` option, `data-deepglot-no-translate` opt-out, `switcher.js` progressive enhancement for `aria-expanded` sync (PR #46). Bumped to v0.3.0.
- Added nav-menu integration: place the switcher in any WP menu; dropdown/hide-current modifier classes; hierarchy preserved for nested items (PR #47). Bumped to v0.4.0.
- Added Gutenberg block (`deepglot/switcher`) with alignment attribute support and classic `WP_Widget`; both delegate to `LanguageSwitcher::renderShortcode` so all placement methods render identical markup (PR #48). Bumped to v0.5.0.
- Fixed active-language detection (captured before `REQUEST_URI` strip) and `LinkRewriter` skipping `data-deepglot-no-translate` subtrees to prevent switcher links from being rewritten (PR #50). Bumped to v0.5.1.
- Gated `aria-expanded` behind an `isDropdownWrapper` helper so list-style wrappers no longer claim expandable state (PR #51). Bumped to v0.5.2.

## Latest Verified Links

- `https://deepglot.ai/`
- `https://deepglot.ai/pricing`
- `https://www.deepglot.ai/api/public/status`
- `https://www.meinhaushalt.at/en/`
- `https://github.com/ostheimer/deepglot/commit/b84f8d38`

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

## Known Open Items

### Phase 7 (production hardening, open)

- 7.13: Anti-drift guard for marketing copy (`marketing-home.test.ts` scanning for hardcoded billing plan values not sourced from `BILLING_PLANS`).
- 7.14: Playwright slider-alignment regression test for `PricingGrid` that asserts thumb centre pixel within ±2 px of active tick label centre.
- 7.15: Stripe webhook end-to-end smoke for subscription-lifecycle events covering `getEffectiveWordsLimit` grace-period policy.

### External Blocks

- Stripe live/test billing acceptance remains postponed until real Stripe live/test keys, webhook secret, and monthly price IDs are intentionally configured.
- Phase 6 subdomain live QA remains blocked until a real mapped production host is configured through `DEEPGLOT_PHASE6_SUBDOMAIN_HOST`.
- Phase 7.8 Stripe live billing acceptance is postponed as an external dependency.

## Recommended Next Work

- Implement Phase 7.13–7.15 test guards before resuming larger product work.
- Consider Phase 8 continuation: additional WordPress plugin hardening (additional placement methods, multisite support, etc.), expanded translation provider coverage, or next SaaS product features.
- Keep the test-first bug workflow from `AGENTS.md`: reproduce reported UI bugs with Playwright first, then fix and prove the fix.
- For future UI audits, prefer expanding `tests/e2e/full-ui-audit.spec.ts` rather than doing one-off manual checks.
