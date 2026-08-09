# Design QA: Donau Signal hero spacing follow-up

## Comparison setup

- User reference: `/var/folders/js/dx8_wz_5529drkxwcr3b2xxr0000gn/T/codex-clipboard-f5d4f457-072c-42a6-9feb-3461a82f12f0.png`.
- Normalized production before state: `/Users/andreasostheimer/.codex/visualizations/2026/08/01/deepglot-hero-whitespace-before.png`.
- Final local implementation: `/Users/andreasostheimer/.codex/visualizations/2026/08/01/deepglot-hero-whitespace-lowered-local.png`.
- Same-viewport before/after comparison: `/Users/andreasostheimer/.codex/visualizations/2026/08/01/deepglot-hero-whitespace-before-after.png`.
- Final Vercel preview: `/Users/andreasostheimer/.codex/visualizations/2026/08/01/deepglot-hero-whitespace-vercel-preview.png`.
- Final production: `/Users/andreasostheimer/.codex/visualizations/2026/08/01/deepglot-hero-whitespace-production.png`.
- Validated preview: `https://deepglot-8x9y1rg3u-andreas-ostheimers-projects.vercel.app` (`dpl_HoVfLoY5q3EJQEhtetgFdXLUni9B`).
- Production: `https://deepglot.ai` (`dpl_E9gVzZWw9rVtPvKrCko3YLkg1n1o`).
- Desktop viewport: 1440 x 900 pixels. Mobile viewport: 390 x 844 pixels.

## Comparison history

1. The normalized production state placed the copy and showcase at y = 117. The 400-pixel showcase therefore left 307 pixels below it and only 20 pixels above it inside the hero.
2. Centering the complete desktop grid row moved both columns and displaced the copy by 34 pixels, so that attempt was rejected.
3. The final implementation applies desktop self-alignment only to the showcase. The copy remains at y = 117 while the showcase moves from y = 117 to y = 269.
4. Final desktop spacing is 172 pixels above and 155 pixels below the showcase, reducing the lower whitespace by 152 pixels without changing the copy or hero height.
5. The `lg:`-scoped change leaves the mobile stack unchanged: copy first, showcase second, 40-pixel natural gap, and no horizontal overflow.

## Final findings

- Layout: the website preview now sits visually centered in the available vertical space beside the text block. The text position, hero height, image crop, language tabs, and following proof strip remain unchanged.
- Responsiveness: horizontal overflow is 0 pixels at 1440 x 900 and 390 x 844. The mobile hierarchy and CTAs remain readable.
- Localization: selecting `English` on preview and production changes the full showcase navigation to `Services`, `Projects`, `About us`, `Contact`, and `Request a quote`, plus the English heading, body, and CTA.
- Visual fidelity: typography, orange brand color, architecture image, borders, shadows, and text content match the approved Donau Signal direction. The combined same-viewport comparison confirms that only the requested vertical placement changed.
- Runtime: no Next.js error overlay appeared on preview or production, the browser console contained no errors, and Vercel returned no production error logs after rollout.
- Verification: 368 unit tests passed. TypeScript, local production build, Vercel preview build, and Vercel production build passed. A stale concurrently generated `.next/dev` artifact was moved aside before the final isolated TypeScript run.
- Production smoke: 7/7 checks passed, including apex/WWW status, canonical redirect, DNS, pricing, and the translated WordPress path.
- Scope safety: the release artifact used the complete current `src` tree and marketing assets while explicitly excluding the six unrelated dirty WordPress plugin files.

## Follow-up polish

- No P0, P1, P2, or P3 follow-up is required for this spacing adjustment.

final result: passed
