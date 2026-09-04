# @warpgogol/warpgogol-billing-cloudflare

Cloudflare D1 storage adapter for the billing read projection.

Implements [RFC-1012](../../docs/rfcs/rfc-1012-billing-read-projection-and-pdf-references.md).

## Overview

- **`D1BillingStore`** — implements `BillingStore` from `@warpgogol/warpgogol-billing-core` using Cloudflare D1
- Uses `INSERT ... RETURNING` with a monotonic sequence table for revision allocation

## D1 Schema Reference

The consuming service owns the D1 migrations. The expected schema is:

```sql
CREATE TABLE invoices (
  invoice_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  number TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  issued_at TEXT,
  due_at TEXT,
  paid_at TEXT,
  pdf_ref TEXT NOT NULL
);

CREATE TABLE payments (
  payment_id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  recorded_by TEXT NOT NULL
);

CREATE TABLE billing_revision_sequence (
  project_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
```
