# Function region change (2026-10-20)

## Production release record

Andreas explicitly approved the region-only production release after the
controlled Preview experiments. PR [#400](https://github.com/ostheimer/deepglot/pull/400)
was squash-merged on 2026-10-20 at 17:30:22 UTC as
`cdde476017b673cd7fe13595b334122fdc01dfb7`. Its source tree exactly matches
the previously tested region PR head `ffb255d`.

Production deployment `dpl_AA6RSiYxkoSgeCtjKY7GUpLezQib` is READY, targets
production, uses Node 24.x and `fra1`, and serves `deepglot.ai` / `www.deepglot.ai`.
This was verified from deployment metadata and aliases, not CDN ingress headers.
The [merge-commit CI run](https://github.com/ostheimer/deepglot/actions/runs/39466667575)
completed successfully, independently of the green pre-merge PR CI. Both the
actual main commit and its Vercel production deployment were monitored to green.

The temporary measurement code remains on a separate local experiment branch;
none of it was merged. Cron paths/schedules, larger cache settings, database
resolution, build policy, project environment variables and subscriptions were
not changed. Production remains on its existing Frankfurt `prod` database branch.

Live read-only checks cover database connectivity (`SELECT 1`), languages and
language-pair responses, public pages, anonymous dashboard redirection, and the
existing signed-in dashboard session. No customer data was modified. Measurement
headers are absent even on a marked request. No live cost-saving claim is made:
Preview handler models are not production billing, and complete comparable
post-release billing periods are still needed.

Rollback reference: previous production `dpl_7ErrTios8ve2zWKTmLbaatun1AGR`,
commit `8bd7107`, `iad1`. No rollback has been performed.

README, plugin version/changelog and public website content need no change for
this infrastructure-only release. This release record supersedes the historical
preparation-only status below.

## Historical preparation record

Status at preparation: review only. No merge, Preview deployment, production
deployment, or database query had been authorized at that point.

### Verified placement

The Vercel Marketplace Neon organization was checked on 2026-10-20. An in-memory
comparison of the configured `DEEPGLOT_DATABASE_URL` endpoints with the console's
branch compute metadata confirmed:

| Environment | Neon project | Branch | Region | Pooling |
| --- | --- | --- | --- | --- |
| Production | deepglot | prod | AWS eu-central-1 (Frankfurt) | enabled |
| Preview | deepglot | main | AWS eu-central-1 (Frankfurt) | enabled |
| Development | deepglot | main | AWS eu-central-1 (Frankfurt) | enabled |

No credentials, connection strings, or endpoint hostnames are recorded here.
The running production deployment still uses Washington (`iad1`). The proposed
`regions: ["fra1"]` places application functions near the existing database;
it does not move the database or create branches.

### Scope and deployment hold

- Preserve all four cron paths and schedules exactly.
- Preserve the existing PR-only preview build policy, authentication,
  API-key activity throttling, queues, and cache behavior.
- Disable automatic Git deployments only for
  `codex/deepglot-region-fra1-20261020` using `git.deploymentEnabled`.
  Other branches, including `main`, retain their existing behavior.
- Keep the PR unmerged until Andreas explicitly approves deployment. A merge
  into `main` would still deploy: the branch-specific hold is not a production
  deployment lock. Do not enable auto-merge or issue a manual deployment.

### Expected effect and cost caveat

Shorter database round trips are expected, not yet measured. This is not a
guaranteed cost reduction: published Fluid Compute rates are $0.184 per active
CPU-hour / $0.0152 per GB-hour in Frankfurt versus $0.128 / $0.0106 in Washington.
These unit prices are approximately 44% / 43% higher. CPU or provisioned-memory
usage would have to fall by approximately 30% to offset the respective rate
increase, assuming an otherwise identical workload and no credits or discounts.
Faster I/O can reduce memory occupancy but does not itself reduce active CPU.

### Validation and later release gate

The region contract test must first fail on the old configuration, then pass
with this change. It checks the single Frankfurt region, the exact branch-only
deployment hold, and preservation of the rest of `vercel.json`. Run the existing
unit, type, lint, build, WordPress, integration, and browser checks in CI against
its disposable local PostgreSQL service, never production.

Only after separate release approval: compare the actual deployed function
region and request latency/error rate; then compare CPU seconds, memory GB-hours,
and priced costs for equivalent complete periods. Do not infer function region
from the CDN ingress header. Preserve the previous production deployment as
the rollback target if latency, errors, or normalized cost regress.

References checked on 2026-10-20:

- [Function regions](https://vercel.com/docs/functions/configuring-functions/region)
- [Branch-specific deployment control](https://vercel.com/docs/project-configuration/git-configuration)
- [Regional Fluid Compute rates](https://vercel.com/docs/functions/usage-and-pricing)
