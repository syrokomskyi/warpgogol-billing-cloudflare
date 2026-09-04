import { describe, it, expect, vi, beforeEach } from "vitest";
import { D1BillingStore } from "../d1-billing-store.ts";

interface MockStatement {
  query: string;
  bindings: unknown[];
  bind(...vals: unknown[]): MockStatement;
  run(): Promise<{ results?: Record<string, unknown>[]; meta?: { changes?: number } }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

function createMockDb() {
  const store = {
    invoices: new Map<string, Record<string, unknown>>(),
    payments: [] as Record<string, unknown>[],
    revisions: [] as { project_id: string; revision: number; created_at: string }[],
  };

  function prepare(query: string): MockStatement {
    let bindings: unknown[] = [];

    const stmt: MockStatement = {
      query,
      bindings,
      bind(...vals: unknown[]) {
        bindings = vals;
        return stmt;
      },
      async run() {
        return { results: [], meta: { changes: 1 } };
      },
      async first<T = Record<string, unknown>>(): Promise<T | null> {
        if (query.includes("MAX(revision)")) {
          const projectId = bindings[0] as string;
          const revs = store.revisions.filter((r) => r.project_id === projectId);
          if (revs.length === 0) return { max_revision: null } as T;
          return { max_revision: Math.max(...revs.map((r) => r.revision)) } as T;
        }
        if (query.includes("SELECT invoice_id") && query.includes("AND invoice_id")) {
          const projectId = bindings[0] as string;
          const invoiceId = bindings[1] as string;
          const key = `${projectId}:${invoiceId}`;
          const row = store.invoices.get(key);
          return (row ?? null) as T | null;
        }
        if (query.includes("SELECT payment_id") && query.includes("LIMIT 1")) {
          const invoiceId = bindings[0] as string;
          const amount = bindings[1] as number;
          const currency = bindings[2] as string;
          const recordedBy = bindings[3] as string;
          const found = store.payments.find(
            (p) =>
              p.invoice_id === invoiceId &&
              p.amount === amount &&
              p.currency === currency &&
              p.recorded_by === recordedBy,
          );
          return (found ?? null) as T | null;
        }
        return null;
      },
      async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
        if (query.includes("SELECT invoice_id") && !query.includes("AND invoice_id")) {
          const projectId = bindings[0] as string;
          const rows = [...store.invoices.values()].filter((r) => r.project_id === projectId);
          return { results: rows as T[] };
        }
        return { results: [] };
      },
    };
    return stmt;
  }

  const db = { prepare };

  const executeSideEffects = (query: string, bindings: unknown[]) => {
    if (query.startsWith("INSERT INTO invoices")) {
      const key = `${bindings[1]}:${bindings[0]}`;
      store.invoices.set(key, {
        invoice_id: bindings[0],
        project_id: bindings[1],
        kind: bindings[2],
        number: bindings[3],
        amount: bindings[4],
        currency: bindings[5],
        status: bindings[6],
        issued_at: bindings[7],
        due_at: bindings[8],
        paid_at: bindings[9],
        pdf_ref: bindings[10],
      });
    }
    if (query.startsWith("INSERT INTO payments")) {
      store.payments.push({
        payment_id: bindings[0],
        invoice_id: bindings[1],
        amount: bindings[2],
        currency: bindings[3],
        recorded_at: bindings[4],
        recorded_by: bindings[5],
      });
    }
    if (query.startsWith("INSERT INTO billing_revision_sequence")) {
      store.revisions.push({
        project_id: bindings[0] as string,
        revision: bindings[1] as number,
        created_at: bindings[2] as string,
      });
    }
  };

  const realPrepare = db.prepare;
  db.prepare = (query: string) => {
    let capturedBindings: unknown[] = [];
    const stmt = realPrepare(query);
    const originalBind = stmt.bind.bind(stmt);
    stmt.bind = (...vals: unknown[]) => {
      capturedBindings = vals;
      originalBind(...vals);
      return stmt;
    };
    const originalRun = stmt.run.bind(stmt);
    stmt.run = async () => {
      executeSideEffects(query, capturedBindings);
      return originalRun();
    };
    return stmt;
  };

  return { db, store };
}

describe("D1BillingStore", () => {
  let mock: ReturnType<typeof createMockDb>;
  let d1Store: D1BillingStore;

  beforeEach(() => {
    mock = createMockDb();
    d1Store = new D1BillingStore({ db: mock.db as any });
  });

  it("returns revision 0 for unknown project", async () => {
    expect(await d1Store.getRevision("proj-001")).toBe(0);
  });

  it("upserts invoice and increments revision", async () => {
    await d1Store.upsertInvoice("proj-001", {
      kind: "activation",
      number: "2026-001",
      amount: 1000,
      currency: "EUR",
      status: "due",
      issuedAt: null,
      dueAt: null,
      paidAt: null,
      pdfRef: "r2://invoices/001.pdf",
    });
    expect(await d1Store.getRevision("proj-001")).toBe(1);
  });

  it("retrieves upserted invoice", async () => {
    const created = await d1Store.upsertInvoice("proj-001", {
      kind: "activation",
      number: "2026-001",
      amount: 1000,
      currency: "EUR",
      status: "due",
      issuedAt: null,
      dueAt: null,
      paidAt: null,
      pdfRef: "r2://invoices/001.pdf",
    });
    const found = await d1Store.getInvoice("proj-001", created.invoiceId);
    expect(found).not.toBeNull();
    expect(found!.number).toBe("2026-001");
  });

  it("returns billing read model with invoices", async () => {
    await d1Store.upsertInvoice("proj-001", {
      kind: "activation",
      number: "2026-001",
      amount: 1000,
      currency: "EUR",
      status: "due",
      issuedAt: null,
      dueAt: null,
      paidAt: null,
      pdfRef: "r2://invoices/001.pdf",
    });
    const model = await d1Store.getBillingReadModel("proj-001");
    expect(model).not.toBeNull();
    expect(model!.revision).toBe(1);
    expect(model!.invoices).toHaveLength(1);
    expect(model!.invoices[0].number).toBe("2026-001");
  });

  it("records payment and increments revision", async () => {
    const inv = await d1Store.upsertInvoice("proj-001", {
      kind: "activation",
      number: "2026-001",
      amount: 1000,
      currency: "EUR",
      status: "due",
      issuedAt: null,
      dueAt: null,
      paidAt: null,
      pdfRef: "r2://invoices/001.pdf",
    });
    const payment = await d1Store.recordPayment("proj-001", inv.invoiceId, {
      amount: 500,
      currency: "EUR",
      recordedBy: "operator@example.com",
    });
    expect(payment.paymentId).toBeTruthy();
    expect(payment.amount).toBe(500);
    expect(await d1Store.getRevision("proj-001")).toBe(2);
  });

  it("is idempotent for exact tuple match", async () => {
    const inv = await d1Store.upsertInvoice("proj-001", {
      kind: "activation",
      number: "2026-001",
      amount: 1000,
      currency: "EUR",
      status: "due",
      issuedAt: null,
      dueAt: null,
      paidAt: null,
      pdfRef: "r2://invoices/001.pdf",
    });
    const p1 = await d1Store.recordPayment("proj-001", inv.invoiceId, {
      amount: 500,
      currency: "EUR",
      recordedBy: "operator@example.com",
    });
    const p2 = await d1Store.recordPayment("proj-001", inv.invoiceId, {
      amount: 500,
      currency: "EUR",
      recordedBy: "operator@example.com",
    });
    expect(p2.paymentId).toBe(p1.paymentId);
  });

  it("creates separate payments for different recordedBy", async () => {
    const inv = await d1Store.upsertInvoice("proj-001", {
      kind: "activation",
      number: "2026-001",
      amount: 1000,
      currency: "EUR",
      status: "due",
      issuedAt: null,
      dueAt: null,
      paidAt: null,
      pdfRef: "r2://invoices/001.pdf",
    });
    const p1 = await d1Store.recordPayment("proj-001", inv.invoiceId, {
      amount: 500,
      currency: "EUR",
      recordedBy: "a@example.com",
    });
    const p2 = await d1Store.recordPayment("proj-001", inv.invoiceId, {
      amount: 500,
      currency: "EUR",
      recordedBy: "b@example.com",
    });
    expect(p2.paymentId).not.toBe(p1.paymentId);
  });
});
