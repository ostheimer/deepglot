# Professional translation orders (#272)

Status: implementation candidate, **off in every environment**. This document
is an operational acceptance contract, not legal, tax, merchant, privacy or
production approval. The existing export → vendor → import and member review
workflow remains available while ordering is off.

## Product and data contract

Only a project manager can create an order from 1–100 existing segments in one
active target language. The server rechecks project ownership and language,
copies the original text, hash and update timestamp into an order item, records
the scope digest and word count, and never reprices an accepted snapshot. The
quote is supplied by a specifically authorized vendor; it records minor-unit
price, ISO currency, turnaround days, vendor reference, terms version and an
expiry no more than 30 days away. An expired quote cannot be accepted.

The manager issues a random, one-order vendor capability. Only its SHA-256
digest is stored; it expires within 14 days and can read only that order's
source scope. The first valid quote selects a vendor grant and revokes other
grants for that order. The selected grant alone can start and deliver work.
Cancellation, failure or final delivery revokes outstanding grants. No SaaS API
key, project membership, unrelated project, billing details or user profile is
returned to the vendor endpoint. Token distribution requires an approved secure
channel and vendor agreement; do not paste tokens into tickets or logs.

State progression: `QUOTE_REQUESTED → QUOTED → PAYMENT_PENDING → PAID →
IN_PROGRESS → DELIVERED`. Quote expiry becomes `EXPIRED`. Before payment,
cancellation becomes `CANCELED`; after payment it becomes `REFUND_PENDING`.
A late payment after cancellation also becomes `REFUND_PENDING`. Verified
provider callbacks alone may mark `PAID`, `REFUNDED` or `DISPUTED`; failure is
tracked as `FAILED`. All financial and fulfillment events carry provider
references and are idempotent. Work does not start on a checkout redirect.

Delivery must contain exactly the quoted items. It writes proposed text only
to order item drafts, leaving the authoritative translation cache unchanged.
The manager sees source and proposal side by side. A separate explicit approve
action checks that the source translation and language are still current, then
atomically adopts one proposed text, marks its workflow `APPROVED`, stores a
content revision, and queues the existing translation webhook. A stale source
requires a new order/reconciliation; the vendor cannot force an overwrite.
Other members' assignments and existing import/export behavior are untouched.

## Ownership decisions required before launch

| Decision | Owner must record | Acceptance evidence |
| --- | --- | --- |
| Merchant and vendor model | Seller of record, vendor contract party, whether platform sells a service or intermediates it, payout and liability model | Signed business decision and approved vendor agreement |
| Pricing and terms | Currency/rounding, minimum price, revisions, quote validity, turnaround start, cancellation windows, vendor service level | Versioned customer and vendor terms tied to quote terms version |
| Payment | Merchant account, one-time Checkout integration, asynchronous success/failure webhooks, idempotency, duplicate/late payment and refund handling | Isolated sandbox payment, replay, late payment, refund and dispute acceptance |
| Tax and invoice | Tax registration jurisdictions, seller/invoice issuer, tax code, reverse-charge treatment where applicable, invoice/credit-note ownership | Qualified tax review and example invoices/credit notes; no assumed Stripe Tax registration |
| Disputes and failures | Who handles chargebacks, vendor non-delivery, partial delivery, rework, refund decisions and support response times | Named operational owner and exercised failure runbook |
| Privacy | Vendor role/processor agreement, permitted content, sensitive data exclusions, data location, retention/deletion, access logs and breach contact | Approved privacy notice, DPA and least-privilege review |
| Production | Schema/trigger installation, monitoring, rate limits, abuse limits, backup/restore, browser/device and bilingual QA | Signed production acceptance and live environment smoke evidence |

## Deployment gate and developer verification

The API and order UI are hidden unless all five environment flags are exactly
`true`: `PROFESSIONAL_ORDERS_ENABLED`,
`PROFESSIONAL_ORDERS_LEGAL_ACCEPTED`,
`PROFESSIONAL_ORDERS_PRIVACY_ACCEPTED`,
`PROFESSIONAL_ORDERS_BILLING_ACCEPTED`, and
`PROFESSIONAL_ORDERS_PRODUCTION_ACCEPTED`. No flag is set by default. These
flags represent recorded approvals; setting them is not itself approval.
Because no merchant, tax, invoice or vendor contract decision is recorded,
**do not enable the flags in shared Preview or Production**. The internal
payment adapter contract has no live Stripe route or key configuration yet;
`PAYMENT_PENDING` cannot advance from a browser request.

For a disposable local PostgreSQL database only: apply `npx prisma db push`,
then run `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f
scripts/sql/professional-order-integrity.sql` twice. The script is additive
and idempotent and creates DB triggers preventing scope/quote/delivery/event
mutation. The triggers are required for launch because Prisma schema push does
not create them. Verify `pg_trigger` names and that attempts to update order
scope and order item source text fail. Run the focused unit and local integration
tests using `DEEPGLOT_ORDER_TEST_DATABASE_URL` pointed only at the disposable
instance. Never point that variable at Neon or a customer database.

Before activation, implement the chosen payment adapter with signed webhooks,
Checkout session creation, payment/refund/dispute readback, invoice and tax
handling. The adapter must call `recordProfessionalPayment` and
`recordProfessionalSettlement` only after verified provider events. It must
never initiate a subscription upgrade or purchase translation credits.
Reconcile `PAYMENT_PENDING`, `REFUND_PENDING`, `DISPUTED` and `FAILED` daily with
the named merchant/support owner. No actual vendor or Stripe calls are made by
this candidate implementation.
