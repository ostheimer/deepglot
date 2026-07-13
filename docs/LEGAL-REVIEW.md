# Legal review checklist

Status: launch draft for owner and qualified legal review, 2026-07-13.

This checklist is a product-maintenance guard, not legal advice or a guarantee
of compliance. Issue #159 must remain open until the owner and, where needed,
qualified counsel approve the public English and German texts for the intended
customer groups and launch markets.

## Approval record

- [ ] Confirm the operator name, company form, register number, VAT number,
  address, partners, ownership percentages, email address, and telephone number.
- [ ] Confirm whether additional Austrian trade-authority, chamber, company-
  court, professional-law, or supervisory disclosures are required.
- [ ] Confirm whether the terms target businesses, consumers, or both and add
  any mandatory consumer withdrawal information and model form.
- [ ] Record reviewer, approval date, approved commit, launch countries, and
  next scheduled review.
- [ ] Verify the rendered `/legal-notice`, `/terms`, `/privacy`,
  `/de/impressum`, `/de/agb`, and `/de/datenschutz` routes.

## Billing and contract changes

Run legal review whenever a change affects:

- plan names, pricing, taxes, billing interval, automatic renewal, trial, or
  Enterprise contracting;
- Stripe Checkout, billing portal, invoices, payment methods, refunds,
  cancellation timing, or subscription status;
- project, language, monthly word quota, rate-limit, abuse-control, or fair-use
  behavior;
- suspension, termination, warranty, availability, support, liability, or
  governing-law wording;
- hosted versus self-hosted responsibility, licence terms, operational support,
  backups, or third-party charges.

Confirm that cancellation still takes effect at the end of the paid billing
period unless mandatory law or an individual agreement requires otherwise.
Confirm that cancellation and account or project deletion remain separate
flows and that customers have a practical export path before deletion.

## Privacy and security changes

Run privacy and legal review whenever a change affects:

- account, OAuth, organization, project, translation, glossary, import/export,
  visual-editor, analytics, webhook, support, security, or billing data;
- processor or recipient lists, including Vercel, Neon, Cloudflare, Stripe,
  GitHub, Google, translation providers, custom gateways, and subprocessors;
- provider API credentials, secret encryption, webhook payloads, runtime logs,
  cookies, browser storage, or page-view analytics;
- processing purpose, legal basis, data region, international transfer
  mechanism, retention period, backup deletion, or data-subject rights;
- account deletion, organization ownership, project deletion, export formats,
  or deletion requests sent to downstream providers;
- incident response, authentication, access control, abuse prevention, or any
  automated decision with legal or similarly significant effects.

For each affected data category, record the controller or processor role,
purpose, fields, source, recipients, legal basis, location, transfer safeguard,
retention rule, deletion mechanism, and response path for access, correction,
restriction, portability, objection, and deletion requests. Verify current
data-processing agreements and subprocessor disclosures rather than assuming
that a vendor name alone is sufficient.

## Public statements and dispute-resolution references

- [ ] Keep German frontend copy in real umlauts.
- [ ] Do not publish claims of uninterrupted availability, perfect translation,
  certified compliance, or guaranteed provider locations without evidence.
- [ ] Do not restore the obsolete EU Online Dispute Resolution platform link.
  The platform was discontinued on 2025-07-20 under Regulation (EU) 2024/3228;
  use the official regulation as the review source:
  <https://eur-lex.europa.eu/eli/reg/2024/3228/oj>.
- [ ] Re-check any consumer-dispute wording against the current law and the
  actual willingness or obligation to participate in a procedure.
- [ ] Update the visible revision date and this approval record after review.
