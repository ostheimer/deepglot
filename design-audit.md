# Deepglot full-design audit

Date: 2026-08-01
Production audited: `https://deepglot.ai`
Viewports: 1440 × 900 desktop, 390 × 844 mobile

## Evidence captured before implementation

- Homepage desktop: `/Users/andreasostheimer/.codex/visualizations/2026/08/01/deepglot-full-rollout-audit/01-home.png`
- Pricing desktop: `/Users/andreasostheimer/.codex/visualizations/2026/08/01/deepglot-full-rollout-audit/02-pricing.png`
- Documentation desktop: `/Users/andreasostheimer/.codex/visualizations/2026/08/01/deepglot-full-rollout-audit/03-docs.png`
- Privacy desktop: `/Users/andreasostheimer/.codex/visualizations/2026/08/01/deepglot-full-rollout-audit/04-privacy.png`
- Login desktop: `/Users/andreasostheimer/.codex/visualizations/2026/08/01/deepglot-full-rollout-audit/05-login.png`
- Missing blog route: `/Users/andreasostheimer/.codex/visualizations/2026/08/01/deepglot-full-rollout-audit/06-blog-missing.png`
- Homepage mobile: `/Users/andreasostheimer/.codex/visualizations/2026/08/01/deepglot-full-rollout-audit/07-home-mobile.png`
- Pricing mobile: `/Users/andreasostheimer/.codex/visualizations/2026/08/01/deepglot-full-rollout-audit/08-pricing-mobile.png`
- Login mobile: `/Users/andreasostheimer/.codex/visualizations/2026/08/01/deepglot-full-rollout-audit/09-login-mobile.png`

## Findings

### P0 — released site did not match the approved direction

Production had returned to the legacy violet homepage, pricing and authentication styling. The approved cream, navy and signal-orange homepage existed only in an uncommitted local state, so a later deployment from `main` replaced it.

Action: build the release from a clean branch based on current `origin/main`, commit every required source and asset, then deploy that reproducible tree.

### P0 — missing brand and publishing surfaces

The browser still served the Create Next App / Vercel favicon. No application icon, Apple icon, manifest, OpenGraph card, robots route, sitemap or Deepglot blog archive existed. `/blog` returned 404.

Action: derive the icon set and social card from the approved Deepglot mark and Austrian interior image; add metadata routes and a real static editorial archive with article routes.

### P1 — inconsistent identity across route families

Marketing navigation used the new mark locally, while pricing, authentication and dashboard areas still used generic globe symbols. Legal and documentation pages retained generic white/gray shells and inconsistent footers.

Action: introduce shared logo, navigation and footer components; carry the warm cream surface, navy typography and orange action color through marketing, legal, documentation, authentication and dashboard shells.

### P1 — mobile navigation was visibly clipped

The marketing subnavigation overflowed horizontally at 390 px, leaving the final item partially cut off.

Action: use a wrapping mobile navigation with complete, reachable labels rather than a clipped horizontal row.

### P2 — WordPress product UI retained the previous violet accent

The plugin settings, switcher editor selection and visual editor controls still contained the previous violet hex and RGBA tokens.

Action: replace those tokens with the signal-orange palette and expand the brand acceptance test to cover the WordPress plugin source.

## Approved visual source

The implementation target is the user-approved Donau Signal homepage captured at:

`/Users/andreasostheimer/.codex/visualizations/2026/08/01/deepglot-hero-whitespace-production.png`

Its governing characteristics are warm cream surfaces, deep navy typography, signal-orange actions, restrained mint confirmation states, Manrope typography, architectural imagery, an explicit Austrian origin and selected-language-first storytelling.
