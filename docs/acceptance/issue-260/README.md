# Issue #260 acceptance evidence (2026-10-09)

## Local implementation

The project language-model page exposes four persisted context fields and two independent switches. GET, PATCH, and the explicit suggestion POST all require project management access. POST uses only existing project metadata; it does not call a provider or save a description. The Chromium test verified that a suggestion did not change the GET result, then saved settings, reloaded them, checked the German view, preserved provider/model on a partial PATCH, and rejected anonymous POST.

The existing `/api/translate` path supplies bounded project context only for uncached work after its cache, glossary, quota, and velocity checks. The configured provider and fallback adapters retain the same context. Provider fixtures cover OpenAI and compatible gateways, OpenRouter, Ollama, Gemini, and DeepL without paid requests. Exact manual/cache translations and protected glossary terms retain priority. The 4,000-character test includes full fields, glossary rules, examples, and saved additional instructions.

Node 20 unit suite: 784 passed. Isolated PostgreSQL integration suite: 50 passed. WordPress suite, TypeScript typecheck, application build, documentation language check, and focused Chromium provider settings (5 tests) passed. ESLint reported no errors and four pre-existing warnings.

## Schema rollout

The only schema difference from the previous main commit is six additive `ProjectSettings` columns. `scripts/sql/translation-project-context.sql` was applied twice to a local database built from that old schema; the target-schema checker found zero pending statements. An independent local database persisted the context fields and kept approved/manual examples within the intended project and language pair.

The Vercel Preview `DEEPGLOT_DATABASE_URL` host matched the Neon `main` branch host. A read-only SQL plan against that branch matched exactly the six expected columns. The additive SQL was applied there once; all six columns appeared, the `Translation` row count remained 742, and the target-schema checker passed all five categories with zero pending statements. This is schema readiness, not a deployed Preview or Production acceptance claim.

Production requires a separate exact-target plan and additive application before the new Prisma reader is deployed, followed by a ready deployment bound to the merged SHA, main CI, and authenticated read-only feature readback. No customer translation text may be edited for acceptance.
