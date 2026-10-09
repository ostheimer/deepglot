# Professional translation orders (#272)

Status: implementation candidate, **off in every environment**. This document
is an operational acceptance contract, not legal, tax, merchant, privacy or
production approval. The existing export → vendor → import and member review
workflow remains available while ordering is off.

## Product and data contract

Only a project manager can create an order from 1–100 existing segments in one
active target language. The server rechecks project ownership and language,
copies the original text, hash and update timestamp into an order item, records
the scope digest, originating workspace and word count, and never reprices an
accepted snapshot. The manager's role, current workspace owner and active language are rechecked
inside every write transaction under Organization → Project row locks; a
revocation or transfer after the API gate therefore cannot authorize a write.
The quote is supplied by a specifically authorized vendor; it records minor-unit
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

The order's original `organizationId` and `projectId` never change. Its
`activeProjectId` is a separate live reference. The database holds a project
transfer or deletion while an order is quoted, payment-pending, paid, in work,
delivered, refund-pending, disputed or failed. An `EXPIRED` order or a
`CANCELED` order with **no durable Checkout attempt and no payment identity**
can detach. A `REFUNDED` receipt can detach only with persisted Checkout,
PaymentIntent, payment and full-refund references. An unbound Checkout attempt
remains unresolved even after its retry window expires; age never silently
proves that no payment happened. Transfer and deletion clear only the live
reference, never the immutable origin, quote, item, event or payment evidence.
The integrity script backfills legacy live references once and marks detached
receipts so reruns cannot reattach them. A later verified dispute on a detached
refunded receipt still maps to its originating merchant.

This is a reference-detachment path, **not** a retention period or permission
to erase historical translation/payment content. Before release, integrate
the hold with #267's fresh Organization → Project transfer contract on merged
main and record the actual privacy/retention policy. Never move a late-payment
or refund obligation to the destination workspace. Detached history is not
available through a new manager/vendor project capability; only provider
reconciliation may update its financial state. The source organization's own
deletion and merchant-account retention policy also needs an explicit decision
before launch; an immutable organization ID and Stripe object IDs preserve
attribution, but do not themselves assign an operational dispute owner.

One-time Stripe Checkout uses the accepted quote's amount and currency only.
The server reserves a durable idempotency key in a short transaction, calls
Stripe outside the Organization → Project locks, then binds the returned
Session in a second transaction. A lost response retries the same key for at
most 23 hours; after that, an unbound attempt fails closed for merchant
reconciliation. Signed Checkout success/failure events additionally require a
durable prior Checkout attempt; a canceled quote with no dispatch cannot be
turned into a paid order by an unexpected event. Session and PaymentIntent identity, mode, paid state, quote
reference, scope digest, originating organization, amount and currency are
retrieved and checked server-side after a signed webhook. Untrusted redirect
parameters or webhook metadata alone cannot mark payment. A synthetic
subscription customer is omitted; a real `cus_` customer is reused only from
the same organization. Checkout responses expose only the Stripe URL, no
customer identifier or billing profile. No credit purchase or plan upgrade is
started. Partial refunds remain pending merchant review; full refunds and
chargeback openings are recorded from separately verified Stripe objects.

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
| Merchant and vendor model | Seller of record, vendor contract party, whether platform sells a service or intermediates it, payout and liability model | Recorded owner decision and approved vendor agreement |
| Pricing and terms | Currency/rounding, minimum price, revisions, quote validity, turnaround start, cancellation windows, vendor service level | Versioned customer and vendor terms tied to quote terms version |
| Payment | Merchant account, one-time Checkout ownership, duplicate/late payment and refund handling | Isolated sandbox payment, signed webhook, replay, late payment, refund and dispute acceptance |
| Tax and invoice | Tax registration jurisdictions, seller/invoice issuer, tax code, reverse-charge treatment where applicable, invoice/credit-note ownership | Recorded tax determination and example invoices/credit notes; obtain specialist review only where the actual decision requires it, and do not assume Stripe Tax registration |
| Disputes and failures | Who handles chargebacks, vendor non-delivery, partial delivery, rework, refund decisions and support response times | Named operational owner and exercised failure runbook |
| Privacy | Vendor role/processor agreement, permitted content, sensitive data exclusions, data location, retention/deletion, access logs and breach contact | Approved privacy notice, DPA and least-privilege review |
| Production | Schema/trigger installation, monitoring, rate limits, abuse limits, backup/restore, browser/device and bilingual QA | Recorded production decision supported by AI-run technical QA and live environment smoke evidence |

## Deployment gate and developer verification

The API and order UI are hidden unless all five environment flags are exactly
`true`: `PROFESSIONAL_ORDERS_ENABLED`,
`PROFESSIONAL_ORDERS_LEGAL_ACCEPTED`,
`PROFESSIONAL_ORDERS_PRIVACY_ACCEPTED`,
`PROFESSIONAL_ORDERS_BILLING_ACCEPTED`, and
`PROFESSIONAL_ORDERS_PRODUCTION_ACCEPTED`. No flag is set by default. These
flags represent recorded approvals; setting them is not itself approval.
Because no merchant, tax, invoice or vendor contract decision is recorded,
**do not enable the flags in shared Preview or Production**. The Checkout route
requires the existing `STRIPE_SECRET_KEY`; the separate webhook route requires
`PROFESSIONAL_ORDERS_STRIPE_WEBHOOK_SECRET`. Configure a dedicated Stripe
endpoint for `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
`checkout.session.async_payment_failed`, `charge.refunded`, and
`charge.dispute.created` only after activation decisions. Never reuse the
subscription webhook secret for this endpoint. No real Stripe requests, keys,
customer writes or vendor calls were used during this candidate's QA.

For a disposable local PostgreSQL database only: apply `npx prisma db push`,
then run `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f
scripts/sql/professional-order-integrity.sql` twice. The script is additive
and idempotent and creates DB triggers preventing scope/quote/delivery/event
mutation, holding unresolved project lifecycle changes and detaching terminal
receipts. The triggers are required for launch because Prisma schema push does
not create them. Verify `pg_trigger` names and that attempts to update order
scope and order item source text fail. Also verify that an unresolved Checkout
blocks transfer/deletion and terminal receipts retain their immutable origin
after detachment. Run the focused unit and local integration
tests using `DEEPGLOT_ORDER_TEST_DATABASE_URL` pointed only at the disposable
instance. Never point that variable at Neon or a customer database.

Before activation, record merchant, invoice issuer, tax treatment, credit-note
ownership, vendor agreement and refund execution policy. The Checkout adapter
intentionally creates neither an invoice nor an automatic tax calculation or
refund: those choices require the recorded seller/tax model. Exercise the
dedicated signed webhook route with Stripe's test mode and run AI-led bilingual
browser QA only after those decisions. The order adapter never initiates a
subscription upgrade or purchases translation credits.
Reconcile `PAYMENT_PENDING`, `REFUND_PENDING`, `DISPUTED` and `FAILED` daily with
the named merchant/support owner. No actual vendor or Stripe calls are made by
this candidate implementation.
