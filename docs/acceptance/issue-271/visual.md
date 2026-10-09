# Issue 271 visual exclusion acceptance (local checkpoint)

The visual builder is implemented in PR #379. The earlier CSV import/export slice is in PR #373. This checkpoint records local verification; Preview, production deployment, and authenticated production readback are separate gates.

## SaaS checks

- Node.js 24.21.0: `npm test` passed 782/782 unit tests. `npm run test:wp` passed its PHP and JS suite. `npm run check:docs-language` passed. `npm run typecheck` and `npm run build` passed after the branch was rebased on main's PR #376 and the Prisma client was regenerated.
- A disposable PostgreSQL database on `127.0.0.1:55471` received `prisma db push` and was used for the production build and Chromium acceptance. Dummy Stripe/Auth values were used only in the isolated local process.
- Chromium `tests/e2e/visual-exclusion.spec.ts` passed 2/2: manager click selection of a unique ID and class from a script-free iframe, exact selector/match preview, save/readback through project CRUD, rejection of a generic class, and 404 for a translator before the page loader runs. Both saved test rules were deleted by test cleanup. The direct database readback for the fixture rule prefix was zero after the test.
- The URL builder rejects an external origin, network-path URL, backslash host escape, control character, and private loopback host. The preview route is included in the management authorization guardrail test. It reuses the DNS-rebinding-safe resolver already covered in `webhook-url-safety.test.ts` and pins the actual connection to its validated IP.
- PM review identified that the original socket inactivity timeout could be extended indefinitely by a dripping HTML response. A local HTTP fixture writing every 25 ms reproduced the problem: the 200 ms preview deadline had still not expired after 700 ms. The fixed request uses an absolute timer across connection and response; the same fixture now rejects after about 200 ms. DNS resolution consumes the same overall eight-second budget. The public-host/IP-pinning guard, 1 MiB cap, HTML-only response, and no-redirect policy remain in place.
- Chromium `tests/e2e/visual-exclusion-sandbox.spec.ts` uses request interception on the actual `sandboxHtml` function. During `DOMParser` parsing it observed zero requests despite external image, frame, and stylesheet URLs. After the sanitized HTML was displayed in `sandbox="allow-same-origin"` srcdoc, it observed only the allowed project-origin image; the external image, frame, stylesheet, inline CSS background, script, and meta refresh caused no external request or navigation. This is browser-observed behavior, not an assumption based on CSP alone.
- The public German/English help and developer API pages and README describe public server-rendered HTML, literal page-unique ID/class selection, project-wide scope after WordPress 0.12.12 sync, and the preview limits. They do not promise arbitrary CSS or page-only element rules.

## WordPress runtime response

The repository's unchanged 0.12.12 plugin was activated in an isolated `wordpress:latest` plus MariaDB Compose project (`deepglot271`, port 8094). One temporary public page contained three neutral paragraphs. A temporary MU fixture intercepted only `https://fixture.invalid/api/` and returned `[en]` translations locally; no provider call or customer rule was made. The anonymous `GET /en/visual-fixture-271/` response contained:

```html
<p id="hero-copy">KEEP ID 271</p>
<p class="promo-label">KEEP CLASS 271</p>
<p id="regular-copy">[en] TRANSLATE 271</p>
```

With `/visual-fixture-271/` as a URL exclusion, the same target route returned `TRANSLATE 271` unchanged. With that URL exclusion cleared and `^/visual-fixture-271/` as the regex exclusion, it again returned `TRANSLATE 271` unchanged. With invalid regex `[` instead, the normal paragraph was translated again while the ID and class targets remained unchanged. This distinguishes complete route exclusion from per-element exclusion in the actual anonymous output.

Cleanup: the E2E fixture rule count was zero; the `deepglot271` WordPress containers, MariaDB volumes, PostgreSQL container, temporary Compose override, and MU/setup files were removed. No plugin product file or customer installation changed.
