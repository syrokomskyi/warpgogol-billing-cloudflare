# @warpgogol/warpgogol-billing-cloudflare — Agent Guide

**Workspace type:** Package

Cloudflare D1 storage adapter for the billing read projection.

## Entry points

| Entry point                               | Module           |
| ----------------------------------------- | ---------------- |
| `@warpgogol/warpgogol-billing-cloudflare` | `./src/index.ts` |

## Architecture

- **D1BillingStore** (`src/d1-billing-store.ts`): Implements `BillingStore` from `@warpgogol/warpgogol-billing-core` using Cloudflare D1 `prepare`/`bind`/`run`/`first` API.
- Uses `INSERT ... RETURNING` pattern with a monotonic sequence table (`billing_revision_sequence`) for revision allocation.
- D1 migrations are owned by the consuming service, not this package. The README documents the expected schema as a reference.

## D1 Schema

The consuming service creates tables: `invoices`, `payments`, `billing_revision_sequence`. See `README.md` for the full schema reference.

## Scripts

| Script        | Command                                   |
| ------------- | ----------------------------------------- |
| `build:check` | `pnpm exec tsc -p tsconfig.json --noEmit` |
| `test`        | `vitest run`                              |
| `lint`        | `pnpm exec eslint "src/**/*.ts"`          |
