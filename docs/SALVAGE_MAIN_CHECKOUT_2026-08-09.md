# Salvage inventory: Deepglot main checkout

This is a preservation snapshot, not a product change and not a merge/PR candidate.

## Source and comparison

- Original checkout: `/Users/andreasostheimer/GitHub/deepglot`
- Source commit: `37187f1f5b27ad99ccfbbf2b57f53d13e52c5770` (`feat: support translated WordPress URL slugs`, 2026-07-31)
- Recorded upstream baseline: `origin/main` and `origin/HEAD` at `4d649aa169cc67ee5a5d4a737f76d6fcaaa68209` (`feat(wp-plugin): warm translations in the background instead of blocking renders (#276)`, 2026-08-07)
- Ancestry at capture: source was 1 commit ahead of and 24 commits behind `origin/main`.
- The original checkout had the same source commit and the same 89 modified plus 26 untracked paths as this isolated capture. It was not changed during this work.

## Classification

### Already identical to `origin/main` (57 paths)

48 modified paths and 9 untracked paths are byte-identical to the recorded upstream baseline. They require no port. The untracked paths are:

- `public/marketing/austrian-interior-hero.png`
- `public/marketing/deepglot-mark.png`
- `src/app/api/cron/activity-digest/route.ts`
- `src/app/api/user/activity-digest/route.ts`
- `src/lib/activity-digest-cron.test.ts`
- `src/lib/activity-digest-cron.ts`
- `src/lib/activity-digest.test.ts`
- `src/lib/activity-digest.ts`
- `src/lib/cron-auth.ts`

The modified paths are the dashboard/form/component formatting set, `package-lock.json`, `vercel.json`, and the digest webhook files; all compare cleanly with `git diff --quiet origin/main -- <path>`.

Exact tracked paths:

- `package-lock.json`
- `src/app/(dashboard)/abonnement/karte-rechnungen/page.tsx`
- `src/app/(dashboard)/abonnement/uebersicht/page.tsx`
- `src/app/(dashboard)/dashboard/page.tsx`
- `src/app/(dashboard)/einstellungen/page.tsx`
- `src/app/(dashboard)/projekte/[projektId]/api-keys/page.tsx`
- `src/app/(dashboard)/projekte/[projektId]/einstellungen/page.tsx`
- `src/app/(dashboard)/projekte/[projektId]/einstellungen/setup/page.tsx`
- `src/app/(dashboard)/projekte/[projektId]/einstellungen/sprachmodell/page.tsx`
- `src/app/(dashboard)/projekte/[projektId]/einstellungen/switcher/page.tsx`
- `src/app/(dashboard)/projekte/[projektId]/statistiken/anfragen/page.tsx`
- `src/app/(dashboard)/projekte/[projektId]/statistiken/seitenaufrufe/page.tsx`
- `src/app/(dashboard)/projekte/[projektId]/uebersetzungen/slugs/page.tsx`
- `src/app/(dashboard)/projekte/[projektId]/uebersetzungen/sprachen/page.tsx`
- `src/app/(dashboard)/projekte/[projektId]/uebersetzungen/urls/page.tsx`
- `src/app/(dashboard)/projekte/[projektId]/uebersetzungen/visuell/page.tsx`
- `src/app/(dashboard)/projekte/neu/page.tsx`
- `src/components/abonnement/auto-upgrade-toggle.tsx`
- `src/components/abonnement/billing-address-form.tsx`
- `src/components/abonnement/plan-switcher.tsx`
- `src/components/abonnement/portal-button.tsx`
- `src/components/auth/accept-invite-card.tsx`
- `src/components/auth/forgot-password-card.tsx`
- `src/components/auth/login-card.tsx`
- `src/components/auth/reset-password-card.tsx`
- `src/components/auth/signup-card.tsx`
- `src/components/einstellungen/password-change-form.tsx`
- `src/components/einstellungen/profile-settings-form.tsx`
- `src/components/projekte/add-language-dialog.tsx`
- `src/components/projekte/create-api-key-dialog.tsx`
- `src/components/projekte/enable-page-views-button.tsx`
- `src/components/projekte/exclusions-manager.tsx`
- `src/components/projekte/glossary-table.tsx`
- `src/components/projekte/import-export-panel.tsx`
- `src/components/projekte/language-model-settings-card.tsx`
- `src/components/projekte/pdf-translation-panel.tsx`
- `src/components/projekte/project-members-manager.tsx`
- `src/components/projekte/project-webhooks-manager.tsx`
- `src/components/projekte/projects-table.tsx`
- `src/components/projekte/runtime-sync-banner.tsx`
- `src/components/projekte/settings-toggle.tsx`
- `src/components/projekte/translation-memory-toggle.tsx`
- `src/components/projekte/translation-workflow-panel.tsx`
- `src/components/projekte/visual-editor-launcher.tsx`
- `src/components/statistiken/analytics-range-selector.tsx`
- `src/lib/webhook-cron.test.ts`
- `src/lib/webhook-cron.ts`
- `vercel.json`

### Replaced or superseded by merged main work (33 paths)

The Activity Digest and product-brand/marketing work overlaps merged commits #251, #256, and #236. The local versions are older or intermediate variants; main contains later versions of the same surfaces. This includes the Digest schema/email/settings/docs work, the public-brand styles/components, `design-qa.md`, and the associated acceptance tests.

No patch from this group should be reapplied wholesale: it is intentionally retained in this snapshot only for line-level historical recovery.

Superseded tracked paths:

- `OPERATIONS.md`, `README.md`, `ROADMAP.md`, `package.json`, `prisma/schema.prisma`
- `src/app/(auth)/layout.tsx`
- `src/app/(dashboard)/projekte/[projektId]/einstellungen/wordpress/page.tsx`
- `src/app/globals.css`
- `src/components/abonnement/billing-sidebar-nav.tsx`, `src/components/abonnement/usage-charts.tsx`
- `src/components/dashboard/sidebar.tsx`
- `src/components/marketing/developer-docs.tsx`, `src/components/marketing/marketing-home.tsx`, `src/components/marketing/marketing-nav.tsx`, `src/components/marketing/pricing-grid.tsx`, `src/components/marketing/pricing-page.tsx`, `src/components/marketing/simple-marketing-page.tsx`
- `src/components/projekte/project-sidebar.tsx`
- `src/components/site/language-switcher.tsx`
- `src/components/statistiken/translation-requests-chart.tsx`
- `src/lib/email.test.ts`, `src/lib/email.ts`

Superseded untracked paths:

- `design-qa.md`
- `src/components/einstellungen/activity-digest-preferences.tsx`
- `src/components/marketing/hero-language-preview.tsx`
- `src/lib/activity-digest-delivery.ts`, `src/lib/activity-digest-email.test.ts`, `src/lib/activity-digest-wiring.test.ts`
- `src/lib/brand-color-acceptance.test.ts`
- `src/lib/hero-language-preview.test.ts`, `src/lib/hero-language-preview.ts`
- `src/lib/marketing-hero-locale.test.ts`, `src/lib/marketing-hero-locale.ts`

### Potentially unique but mixed WordPress work (19 paths)

These changes have no byte-identical counterpart in `origin/main` and are retained for later, focused review. They add regression coverage and fixes for:

- delayed dynamic translation of cookie/chat DOM,
- incomplete parallel provider responses falling back atomically and avoiding cache poisoning,
- normalized DOM-text cache keys while preserving visual whitespace,
- `mailto:`/`tel:` links and Deepglot nav-menu links remaining unrevised,
- Avada/UberMenu label duplication, and
- WP Rocket Delay-JS exclusion for the dynamic translator.

The implementation spans `wordpress-plugin/deepglot/assets/js/dynamic-translator.js`, `includes/{Api,Frontend,Support}`, and their PHP/JS tests. It is deliberately not a product PR: it was written against the older URL-slug branch and overlaps subsequent plugin releases.

Potentially unique paths:

- `wordpress-plugin/deepglot/assets/js/dynamic-translator.js`
- `wordpress-plugin/deepglot/includes/Api/Client.php`
- `wordpress-plugin/deepglot/includes/Frontend/DynamicAssets.php`
- `wordpress-plugin/deepglot/includes/Frontend/HtmlTranslator.php`
- `wordpress-plugin/deepglot/includes/Frontend/LinkRewriter.php`
- `wordpress-plugin/deepglot/includes/Frontend/NavMenuSwitcher.php`
- `wordpress-plugin/deepglot/includes/Frontend/OutputBuffer.php`
- `wordpress-plugin/deepglot/includes/Frontend/WpRocketCompat.php`
- `wordpress-plugin/deepglot/includes/Support/TranslationRules.php`
- `wordpress-plugin/deepglot/tests/AccessibilityAttributeTranslationTest.php`
- `wordpress-plugin/deepglot/tests/ClientProblemDetailsTest.php`
- `wordpress-plugin/deepglot/tests/DynamicTranslatorAssetTest.js`
- `wordpress-plugin/deepglot/tests/HtmlLangSwitchTest.php`
- `wordpress-plugin/deepglot/tests/LinkRewriterTest.php`
- `wordpress-plugin/deepglot/tests/NavMenuSwitcherTest.php`
- `wordpress-plugin/deepglot/tests/ParallelBatchesTest.php`
- `wordpress-plugin/deepglot/tests/RawTextEntityEncodingTest.php`
- `wordpress-plugin/deepglot/tests/TranslationRulesTest.php`
- `wordpress-plugin/deepglot/tests/WpRocketCompatTest.php`

### Clear non-product artifacts (6 paths)

The following local Playwright MCP console/page captures are not committed or pushed, because they are transient browser diagnostics and may contain runtime data. The original checkout retains them; their SHA-256 values provide an immutable inventory:

- `console-2026-08-04T15-46-40-246Z.log` — `32d9661b5b637670e443f4c2dcc20529f01eabc0038f13f25162ac5bb7c24884`
- `console-2026-08-04T15-47-08-530Z.log` — `59d988597214433f7c7e856a98c0c66a8b11b6b4daadc00ebf076b48e9f56b85`
- `console-2026-08-04T16-23-30-233Z.log` — `353511b5ced1ad21482d7e4109844c3be904fd308c89e36382abe6bd04e32936`
- `page-2026-08-04T15-46-42-357Z.yml` — `8dc4a52f599ca02628f8b7fa19074bab5bbdacf1712b21c20ab12598ed639563`
- `page-2026-08-04T15-47-59-065Z.yml` — `7e4aa6fbc2f292d64cc0a2c7c514bf0c2693241e516bcdfe88a34d59c13238e7`
- `page-2026-08-04T16-23-31-387Z.yml` — `f5b4e539cb61d9a3e6597d3cdab5adc1b16eba2dec094a91af6d60e158b92a6e`

## Verification

`git diff --check HEAD` passed for the captured local changes. The full snapshot commit excludes only `.playwright-mcp/`; it includes every modified/untracked non-artifact path listed above.

## Safe original-checkout cleanup

After independently retaining the browser artifacts if wanted, run these commands only in the original checkout:

```zsh
cd /Users/andreasostheimer/GitHub/deepglot
git status --short --branch
git fetch --prune origin
backup_dir=$(mktemp -d /tmp/deepglot-main-checkout-backup.XXXXXX)
git diff --binary HEAD > "$backup_dir/working-tree.patch"
git ls-files --others --exclude-standard > "$backup_dir/untracked.txt"
mkdir "$backup_dir/playwright-mcp"
cp -p .playwright-mcp/* "$backup_dir/playwright-mcp/"
shasum -a 256 "$backup_dir"/playwright-mcp/*
git stash push --include-untracked -m "pre-cleanup deepglot main checkout 2026-08-09"
git switch main
git pull --ff-only origin main
git status --short --branch
git stash list -1
```

This does not reset, clean, or overwrite the original checkout: the patch, the six browser artifacts, and a local stash remain recoverable while the pushed salvage commit preserves every non-artifact source path. Confirm the branch, commit, backup directory, and stash before ever dropping the stash.
