# Developer surface decisions

Status: accepted product decisions, 2026-07-13

This note resolves the exploration work in issues #167, #168, #169, and #172.
It deliberately separates a useful future direction from a promise that an
integration is available today. Deepglot remains WordPress-first and its REST
API is the only supported external developer surface until the prerequisites
below are complete.

## Decision principles

- Stabilize and document the public REST contract before adding wrappers.
- Never expose provider credentials, billing secrets, unrestricted project
  mutations, or raw customer content outside the active authenticated task.
- Start new developer surfaces read-only or low-risk. Write operations need
  explicit scopes, clear confirmation, and tenant checks.
- Publish a support and versioning policy before distributing an SDK, CLI,
  MCP server, or agent-skill package.
- Do not claim an integration is supported until its routes, examples, auth
  boundaries, and failure modes have automated coverage.

## #167: Model Context Protocol server

Decision: **defer**.

An MCP server could make localization status and supported-language discovery
more accessible to AI tools, but shipping it before the REST error contract and
public documentation are stable would multiply drift. Issue #166 (Problem
Details) and issue #158 (public developer documentation) are prerequisites.
Issue #161 (idempotent translation retries) is additionally required before a
quota-consuming translation tool can be considered.

Reconsider this decision when all prerequisites are closed and at least two
real users ask for an MCP integration. The first slice should expose one public
read-only resource for supported languages and one authenticated, project-
scoped read-only tool. Write-capable glossary or exclusion tools remain out of
scope until explicit OAuth/API-key scopes and confirmation semantics exist.

## #168: official SDK and CLI

Decision: **defer both the SDK and CLI**.

The repository currently has no public package workspace, package publishing
pipeline, semantic release process, or compatibility support policy. A wrapper
would therefore create a second unstable contract instead of simplifying the
documented REST API. Issues #158, #161, and #166 must land first. MCP in #167 is
an optional alignment point, not a prerequisite.

Reconsider after the REST reference has been stable for two releases and
developer demand identifies a concrete language/runtime. The first supported
slice should be a TypeScript client with typed bearer/API-key auth, a read-only
supported-languages call, and a translation smoke call. A CLI may then wrap
those same calls. Python, Go, and PHP clients must not be implied before they
exist. No package is published by this decision.

## #169: official agent skills

Decision: **defer**.

Agent skills are workflow guides, not a substitute for stable REST, MCP, or SDK
execution surfaces. Publishing `SKILL.md` packages now would encode placeholder
routes and support promises. Reconsider only after #158 and #166 are closed and
at least one supported execution surface has a versioning policy.

Future skill review checklist:

- Every referenced route and command exists and is covered by an automated contract or anti-drift test.
- Every documentation link resolves to the current public reference.
- Required credentials are narrowly scoped; examples contain no real secrets.
- Read-only behavior is the default. Every write workflow names the mutation,
  asks for explicit confirmation, and documents rollback or recovery.
- Customer content stays inside the active task context and is never copied
  into examples, telemetry, or support artifacts.
- Quota, rate-limit, idempotency, and Problem Details behavior match the live
  API documentation.
- The package declares its support status and last verified Deepglot version.

No official Deepglot agent-skill package is distributed by this decision.

## #172: DPP-ready localization

Decision: **later; strategically relevant only after validation**.

### Narrow product brief

First user segment: EU manufacturers and agencies using WordPress or
WooCommerce to publish public product-passport landing pages reached from QR or
GS1 Digital Link identifiers.

First surface: a documented localization and QA profile for public HTML product
pages. It should preserve identifiers, URLs, units, controlled values, and
compliance-critical glossary terms while translating human-readable content.
It may later add a structured-field translation helper to the documented REST
API, but only after real customer fixtures validate the shape.

Non-goals:

- DPP, ESPR, EN 18216-18223, or GS1 compliance certification.
- Issuing GTINs, operating a GS1 Digital Link resolver, or validating regulatory
  product data.
- Storing or authorizing access to restricted product-passport data.
- Replacing a product information management or digital product passport
  platform.
- Public compliance marketing claims before specialist legal/standards review.

Dependencies: #158 must document the supported integration surface and #166
must stabilize errors. #168 could later provide a QA command and #167 could
later expose read-only validation resources, but neither is required for the
first documentation/QA slice.

Validation gate: interview at least three target users and test representative
public product-page fixtures containing GTINs, GS1 Digital Link URLs, units,
regulated phrases, JSON-LD, and hreflang. Until that gate passes, README,
roadmap, pricing, and public docs must not describe Deepglot as DPP-compliant.
