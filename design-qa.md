# Deepglot full design rollout QA

Date: 2026-08-01

## Visual target

- Approved reference: `/Users/andreasostheimer/.codex/visualizations/2026/08/01/deepglot-hero-whitespace-production.png`
- Final desktop capture: `/Users/andreasostheimer/.codex/visualizations/2026/08/01/deepglot-full-rollout-qa/01-home-desktop.png`
- Same-viewport comparison: `/Users/andreasostheimer/.codex/visualizations/2026/08/01/deepglot-full-rollout-qa/comparison-home-desktop.png`
- Desktop viewport: 1440 x 900
- Mobile viewport: 390 x 844

The final desktop hero matches the approved composition and spacing. The showcase remains beside the copy, its bottom edge aligns with the intended lower position, and the removed language-line graphic does not return. Intentional follow-up differences are the Blog navigation item, the active preview language following the selected site locale, and darker accessible orange for small text and solid controls.

## Route and responsive review

Desktop checks passed for `/`, `/pricing`, `/docs`, `/blog`, `/blog/built-in-austria-for-24-languages`, `/privacy`, `/login`, and `/de`. Every route had the expected title, language, and H1, no horizontal overflow, and no violet or purple utility classes.

Mobile checks passed for `/`, `/pricing`, `/docs`, `/blog`, `/login`, and `/bg`. Every route had zero horizontal overflow at 390 px. The homepage, blog archive, and Bulgarian homepage were inspected visually. The navigation, CTA, headings, cards, and language controls remain readable and usable.

## Localization and interaction

- All 24 site locales have localized showcase navigation, headline, body, and CTA copy.
- The selected site locale is the active first preview tab; Bulgarian was verified with `Български` active.
- The four-tab layout is preserved by adding the selected locale dynamically when it is outside DE, EN, FR, and IT.
- Switching the Bulgarian showcase to English updates its menu, headline, body, CTA, and active state together.
- Unsupported localized Blog and Documentation routes permanently redirect to their real English canonical surfaces; only English and German variants are published in sitemap and hreflang metadata.
- The installable manifest starts in the selected locale while retaining global `/` scope.

## Brand, metadata, and assets

- Orange-on-white controls and orange small text on cream or navy meet WCAG AA contrast.
- Favicon, 512 px app icon, 180 px Apple icon, 192 px PWA icon, maskable icon, Open Graph image, manifest, and robots response all return HTTP 200 without setting a locale cookie.
- The sitemap contains 130 unique canonical URLs; all 130 returned HTTP 200 in the production build crawl.
- Canonical German and English article-slug redirects returned HTTP 308.
- Browser console error log: empty.

## Automated verification

- Unit: 407 passed
- PostgreSQL integration: 8 passed
- Playwright: 32 passed, including all known public and authenticated routes plus public and authenticated mobile shells
- WordPress PHP and JavaScript suites: passed
- TypeScript: passed
- Production build: passed, 56 pages generated
- ESLint: 0 errors; 4 pre-existing warnings
- `git diff --check`: passed

## Findings

No open P0, P1, or P2 visual, responsive, localization, routing, metadata, or accessibility findings remain for this rollout.

final result: passed
