# Issue #260 acceptance evidence (2026-10-09)

## Local implementation

The project language-model page exposes four persisted context fields and two independent switches. GET, PATCH, and the explicit suggestion POST all require project management access. POST uses only existing project metadata; it does not call a provider or save a description. The Chromium test verified that a suggestion did not change the GET result, then saved settings, reloaded them, checked the German view, preserved provider/model on a partial PATCH, and rejected anonymous POST.

The existing `/api/translate` path supplies bounded project context only for uncached work after its cache, glossary, quota, and velocity checks. The configured provider and fallback adapters retain the same context. Provider fixtures cover OpenAI and compatible gateways, OpenRouter, Ollama, Gemini, and DeepL without paid requests. Exact manual/cache translations and protected glossary terms retain priority. The 4,000-character test includes full fields, glossary rules, examples, and saved additional instructions.

Node 20 unit suite: 784 passed. Isolated PostgreSQL integration suite: 50 passed. WordPress suite, TypeScript typecheck, application build, documentation language check, and focused Chromium provider settings (5 tests) passed. ESLint reported no errors and four pre-existing warnings.

## Schema rollout

The only schema difference from the previous main commit is six additive `ProjectSettings` columns. `scripts/sql/translation-project-context.sql` was applied twice to a local database built from that old schema; the target-schema checker found zero pending statements. An independent local database persisted the context fields and kept approved/manual examples within the intended project and language pair.

The Vercel Preview `DEEPGLOT_DATABASE_URL` host matched the Neon `main` branch host. A read-only SQL plan against that branch matched exactly the six expected columns. The additive SQL was applied there once; all six columns appeared, the `Translation` row count remained 742, and the target-schema checker passed all five categories with zero pending statements. Preview deployment `dpl_9fLNVgT9CJoHUAL5RxCk3PgKoTVy` was ready for PR head `eb175dc265903cf16537a185c38919ed700ebe74`. A Chromium test against that Preview passed with a synthetic account and restored its original settings afterward.

The Vercel Production database host matched the Neon `prod` branch host. The read-only preflight found the same six missing columns and no unrelated drift. After all four PR checks passed, the additive SQL was applied once to the direct Production host before merging PR #376. Readback found all six columns, and target-schema acceptance passed all five categories with zero pending statements. The migration did not write customer translation text.

PR #376 was squash-merged as `d2b5e41113933f940e248f8ce9af084d14913a81`. Main CI run `37865655663` completed successfully, including its full Playwright smoke tests. Vercel Production deployment `dpl_J2iCSqSF7q4RcdWExdq6tgfC6xZz` reached `READY`, targets `production`, aliases `deepglot.ai`, and reports that exact Git SHA. In an authenticated Production admin session, a fresh reload of the German project language-model page showed the website-description suggestion, all four context fields, both independent unchecked switches, the existing provider runtime, and the save action. The fields were read without editing customer content or sending a provider request.
