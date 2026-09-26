/*
<MODULE_CONTRACT>
<purpose>d1-billing-store — D1-backed BillingStore implementation using the Cloudflare D1 prepare/bind/run/first API.</purpose>
<non-goals><item>Do not own D1 migrations — the consuming service creates and applies them.</item></non-goals>
</MODULE_CONTRACT>
<CHANGE_SUMMARY>
  <item>RFC-1012: initial D1BillingStore adapter.</item>
  <item>RFC-1097: sweep — tail packages clean

Sweep batch 3: rewrote ~95 purposes across werkstatt-knowledge, werkstatt-shared, godot-game, phaser-game, lifecycle-core, projektarchiv-*, portal-*, billing-*, typescript (CONTRACT-02/PURPOSE-02). Real KEY_DECISIONS on 5 godot utils, non-goals on 5 CONTRACT-03 files, headers on 4 headerless files, CS-07 history literal fix on 2 files. Policy: vitest.config.ts + test-fixtures testPatterns, worker-configuration.d.ts excludedPath. All non-site/engine packages now 0 diagnostics.</item>
</CHANGE_SUMMARY>
*/

import type { BillingStore } from "@warpgogol/warpgogol-billing-core/ports";
import type {
  BillingReadModel,
  InvoiceV1,
  PaymentRecordV1,
} from "@warpgogol/warpgogol-billing-core/schemas";
import { nextRevision } from "@warpgogol/warpgogol-billing-core";

interface D1Result {
  results?: Record<string, unknown>[];
  meta?: { changes?: number };
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<D1Result>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

export interface D1BillingStoreOptions {
  db: D1Database;
}

export class D1BillingStore implements BillingStore {
  private readonly db: D1Database;

  constructor(options: D1BillingStoreOptions) {
    this.db = options.db;
  }

  async getRevision(projectId: string): Promise<number> {
    const result = await this.db
      .prepare(
        "SELECT MAX(revision) AS max_revision FROM billing_revision_sequence WHERE project_id = ?",
      )
      .bind(projectId)
      .first<{ max_revision: number | null }>();
    return result?.max_revision ?? 0;
  }

  async getBillingReadModel(projectId: string): Promise<BillingReadModel | null> {
    const revision = await this.getRevision(projectId);
    const invoicesResult = await this.db
      .prepare(
        "SELECT invoice_id, kind, number, amount, currency, status, issued_at, due_at, paid_at, pdf_ref FROM invoices WHERE project_id = ?",
      )
      .bind(projectId)
      .all<{
        invoice_id: string;
        kind: string;
        number: string;
        amount: number;
        currency: string;
        status: string;
        issued_at: string | null;
        due_at: string | null;
        paid_at: string | null;
        pdf_ref: string;
      }>();

    const invoices: InvoiceV1[] = invoicesResult.results.map((row) => ({
      invoiceId: row.invoice_id,
      kind: row.kind as InvoiceV1["kind"],
      number: row.number,
      amount: row.amount,
      currency: row.currency,
      status: row.status as InvoiceV1["status"],
      issuedAt: row.issued_at,
      dueAt: row.due_at,
      paidAt: row.paid_at,
      pdfRef: row.pdf_ref,
    }));

    return {
      schema: "warpgogol.billing-read-model@1",
      revision,
      invoices,
      observedAt: new Date().toISOString(),
    };
  }

  async getInvoice(projectId: string, invoiceId: string): Promise<InvoiceV1 | null> {
    const row = await this.db
      .prepare(
        "SELECT invoice_id, kind, number, amount, currency, status, issued_at, due_at, paid_at, pdf_ref FROM invoices WHERE project_id = ? AND invoice_id = ?",
      )
      .bind(projectId, invoiceId)
      .first<{
        invoice_id: string;
        kind: string;
        number: string;
        amount: number;
        currency: string;
        status: string;
        issued_at: string | null;
        due_at: string | null;
        paid_at: string | null;
        pdf_ref: string;
      }>();

    if (!row) return null;

    return {
      invoiceId: row.invoice_id,
      kind: row.kind as InvoiceV1["kind"],
      number: row.number,
      amount: row.amount,
      currency: row.currency,
      status: row.status as InvoiceV1["status"],
      issuedAt: row.issued_at,
      dueAt: row.due_at,
      paidAt: row.paid_at,
      pdfRef: row.pdf_ref,
    };
  }

  async upsertInvoice(
    projectId: string,
    invoice: Omit<InvoiceV1, "invoiceId"> & { invoiceId?: string },
  ): Promise<InvoiceV1> {
    const id = invoice.invoiceId ?? crypto.randomUUID();
    await this.db
      .prepare(
        `INSERT INTO invoices (invoice_id, project_id, kind, number, amount, currency, status, issued_at, due_at, paid_at, pdf_ref)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(invoice_id) DO UPDATE SET
           kind = excluded.kind,
           number = excluded.number,
           amount = excluded.amount,
           currency = excluded.currency,
           status = excluded.status,
           issued_at = excluded.issued_at,
           due_at = excluded.due_at,
           paid_at = excluded.paid_at,
           pdf_ref = excluded.pdf_ref`,
      )
      .bind(
        id,
        projectId,
        invoice.kind,
        invoice.number,
        invoice.amount,
        invoice.currency,
        invoice.status,
        invoice.issuedAt,
        invoice.dueAt,
        invoice.paidAt,
        invoice.pdfRef,
      )
      .run();

    const currentRevision = await this.getRevision(projectId);
    const newRevision = nextRevision(currentRevision);
    await this.db
      .prepare(
        "INSERT INTO billing_revision_sequence (project_id, revision, created_at) VALUES (?, ?, ?)",
      )
      .bind(projectId, newRevision, new Date().toISOString())
      .run();

    return {
      invoiceId: id,
      kind: invoice.kind,
      number: invoice.number,
      amount: invoice.amount,
      currency: invoice.currency,
      status: invoice.status,
      issuedAt: invoice.issuedAt,
      dueAt: invoice.dueAt,
      paidAt: invoice.paidAt,
      pdfRef: invoice.pdfRef,
    };
  }

  async recordPayment(
    projectId: string,
    invoiceId: string,
    payment: Omit<PaymentRecordV1, "paymentId" | "recordedAt" | "invoiceId">,
  ): Promise<PaymentRecordV1> {
    const existing = await this.db
      .prepare(
        "SELECT payment_id, invoice_id, amount, currency, recorded_at, recorded_by FROM payments WHERE invoice_id = ? AND amount = ? AND currency = ? AND recorded_by = ? LIMIT 1",
      )
      .bind(invoiceId, payment.amount, payment.currency, payment.recordedBy)
      .first<{
        payment_id: string;
        invoice_id: string;
        amount: number;
        currency: string;
        recorded_at: string;
        recorded_by: string;
      }>();

    if (existing) {
      return {
        paymentId: existing.payment_id,
        invoiceId: existing.invoice_id,
        amount: existing.amount,
        currency: existing.currency,
        recordedAt: existing.recorded_at,
        recordedBy: existing.recorded_by,
      };
    }

    const paymentId = crypto.randomUUID();
    const recordedAt = new Date().toISOString();

    await this.db
      .prepare(
        "INSERT INTO payments (payment_id, invoice_id, amount, currency, recorded_at, recorded_by) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(paymentId, invoiceId, payment.amount, payment.currency, recordedAt, payment.recordedBy)
      .run();

    const currentRevision = await this.getRevision(projectId);
    const newRevision = nextRevision(currentRevision);
    await this.db
      .prepare(
        "INSERT INTO billing_revision_sequence (project_id, revision, created_at) VALUES (?, ?, ?)",
      )
      .bind(projectId, newRevision, new Date().toISOString())
      .run();

    return {
      paymentId,
      invoiceId,
      amount: payment.amount,
      currency: payment.currency,
      recordedAt,
      recordedBy: payment.recordedBy,
    };
  }
}
