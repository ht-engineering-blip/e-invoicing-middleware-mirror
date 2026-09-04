import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import mongoose from "mongoose";
import {
  TransformerCircuitBreaker,
  isRateLimitError,
} from "../src/v1/workflow/utils/transformer/circuit-breaker";
import {
  CircuitBreakerState,
  CircuitBreakerStateModel,
} from "../src/v1/workflow/models/circuit-breaker-state.model";
import { mergeTenantContext } from "../src/v1/workflow/jobs/definitions/transform.job";
import { FIRSInvoiceTransformerV2 } from "../src/v1/workflow/utils/transformer/v2";
import { FIRSInvoiceSchema } from "../src/v1/workflow/utils/transformer/schema-validator";
import { aiConfig } from "../src/@config/ai";

const TEST_URI =
  process.env.MONGODB_TEST_URI ??
  "mongodb://admin:admin123@localhost:27017/cb-test-db?authSource=admin";

/** Force a new breaker instance, standing in for a second worker process. */
function newProcess(): TransformerCircuitBreaker {
  (TransformerCircuitBreaker as any).instance = undefined;
  return TransformerCircuitBreaker.getInstance();
}

let ownsConnection = false;

/**
 * The breaker reads and writes through mongoose's default connection, so these
 * tests need that connection up. Another test file may already have opened it
 * (calling connect() again with a different URI throws), so reuse it when
 * present and only dial the test URI ourselves when nothing is connected.
 */
let mongoUp = false;
try {
  if (mongoose.connection.readyState === 2) {
    await new Promise((resolve) => mongoose.connection.once("connected", resolve));
  }
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 2000 });
    ownsConnection = true;
  }
  mongoUp = mongoose.connection.readyState === 1;
} catch {
  mongoUp = false;
}

// ───────────────────────────────────────────────────────────────────────────
// Pure logic — always runs, no database required
// ───────────────────────────────────────────────────────────────────────────
describe("isRateLimitError", () => {
  it("detects rate limits from the HTTP status", () => {
    expect(isRateLimitError({ response: { status: 429 } })).toBe(true);
    expect(isRateLimitError({ status: 429 })).toBe(true);
    expect(isRateLimitError({ statusCode: 429 })).toBe(true);
  });

  it("detects rate limits from the message", () => {
    expect(isRateLimitError(new Error("429 Too Many Requests"))).toBe(true);
    expect(isRateLimitError(new Error("Rate limit exceeded"))).toBe(true);
    expect(isRateLimitError(new Error("too many requests"))).toBe(true);
  });

  it("does not treat an unrelated 429 substring as a rate limit", () => {
    // The previous /429|.../ test matched these and tripped the breaker.
    expect(isRateLimitError(new Error("Invalid amount 1429.00 on line 2"))).toBe(false);
    expect(isRateLimitError(new Error("invoice INV-4291 rejected"))).toBe(false);
    expect(isRateLimitError({ response: { status: 500 }, message: "server error" })).toBe(false);
  });
});

describe("mergeTenantContext", () => {
  const hydrated = {
    tenantId: "t1",
    businessId: "b1",
    businessTIN: "TIN-1",
    businessName: "Acme",
    tenantERP: "ZOHO_BOOKS",
    tenantMappings: [{ from: "a", to: "b" }],
  };

  // Exactly what orchestrator.ts builds when tenant.config.erpSystem is unset.
  const jobContext = {
    tenantId: "t1",
    businessId: "b1",
    businessTIN: undefined,
    serviceId: undefined,
    tenantERP: undefined,
    isAdmin: false,
  };

  it("keeps hydrated values when the job context carries undefined", () => {
    const merged = mergeTenantContext(hydrated, jobContext);
    expect(merged.tenantERP).toBe("ZOHO_BOOKS");
    expect(merged.businessTIN).toBe("TIN-1");
    expect(merged.tenantMappings).toHaveLength(1);
  });

  it("keeps hydrated values after Agenda's Mongo round-trip turns undefined into null", () => {
    const afterMongo = JSON.parse(
      JSON.stringify({ ...jobContext, businessTIN: null, tenantERP: null }),
    );
    const merged = mergeTenantContext(hydrated, afterMongo);
    expect(merged.tenantERP).toBe("ZOHO_BOOKS");
    expect(merged.businessTIN).toBe("TIN-1");

    // Regression guard: the previous trailing spread produced exactly this.
    expect({ ...hydrated, ...afterMongo }.tenantERP).toBeNull();
  });

  it("ignores empty strings but preserves a legitimate false", () => {
    expect(mergeTenantContext(hydrated, { tenantERP: "" }).tenantERP).toBe("ZOHO_BOOKS");
    expect(mergeTenantContext(hydrated, jobContext).isAdmin).toBe(false);
  });

  it("still lets real job values win over the tenant record", () => {
    const merged = mergeTenantContext(hydrated, {
      tenantERP: "SAGE_X3",
      businessTIN: "TIN-OVERRIDE",
      serviceId: "SVC-9",
    });
    expect(merged.tenantERP).toBe("SAGE_X3");
    expect(merged.businessTIN).toBe("TIN-OVERRIDE");
    expect(merged.serviceId).toBe("SVC-9");
  });

  it("tolerates a missing job context", () => {
    expect(mergeTenantContext(hydrated, null as any).tenantERP).toBe("ZOHO_BOOKS");
    expect(mergeTenantContext(hydrated, {}).tenantERP).toBe("ZOHO_BOOKS");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Persistence-backed behaviour — this is what makes retries safe
// ───────────────────────────────────────────────────────────────────────────
describe.skipIf(!mongoUp)("TransformerCircuitBreaker (persisted)", () => {
  const key = { tenantId: "tenant-a", provider: "openai" };
  const docKey = "transformer:tenant-a:openai";

  beforeEach(async () => {
    await CircuitBreakerStateModel.deleteMany({});
    newProcess();
  });

  afterAll(async () => {
    await CircuitBreakerStateModel.deleteMany({});
  });

  it("does not trip on a single rate limit", async () => {
    const cb = TransformerCircuitBreaker.getInstance();
    await cb.recordFailure(new Error("429 Too Many Requests"), key);
    expect(await cb.getState(key)).toBe(CircuitBreakerState.CLOSED);
    expect(await cb.canExecute(key)).toBe(true);
  });

  it("trips only once the failure threshold is reached", async () => {
    const cb = TransformerCircuitBreaker.getInstance();
    for (let i = 0; i < 2; i++) {
      await cb.recordFailure(new Error("429 Too Many Requests"), key);
    }
    expect(await cb.getState(key)).toBe(CircuitBreakerState.CLOSED);

    await cb.recordFailure(new Error("429 Too Many Requests"), key);
    expect(await cb.getState(key)).toBe(CircuitBreakerState.OPEN);
    expect(await cb.canExecute(key)).toBe(false);

    const wait = await cb.cooldownRemainingSeconds(key);
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(120);
  });

  it("persists state so another process sees the open breaker", async () => {
    const cb = TransformerCircuitBreaker.getInstance();
    for (let i = 0; i < 3; i++) {
      await cb.recordFailure(new Error("429 Too Many Requests"), key);
    }

    const doc = await CircuitBreakerStateModel.findOne({ key: docKey }).lean();
    expect(doc?.state).toBe(CircuitBreakerState.OPEN);
    expect(doc?.failureCount).toBe(3);

    // This is the retry case: a different process, with an empty local cache.
    const other = newProcess();
    expect(await other.getState(key)).toBe(CircuitBreakerState.OPEN);
    expect(await other.canExecute(key)).toBe(false);
  });

  it("scopes state per tenant and per provider", async () => {
    const cb = TransformerCircuitBreaker.getInstance();
    for (let i = 0; i < 3; i++) {
      await cb.recordFailure(new Error("429 Too Many Requests"), key);
    }

    expect(await cb.canExecute(key)).toBe(false);
    expect(await cb.canExecute({ tenantId: "tenant-b", provider: "openai" })).toBe(true);
    expect(await cb.canExecute({ tenantId: "tenant-a", provider: "gemini" })).toBe(true);
  });

  it("half-opens once the cooldown elapses, and closes on a successful trial", async () => {
    const cb = TransformerCircuitBreaker.getInstance();
    for (let i = 0; i < 3; i++) {
      await cb.recordFailure(new Error("429 Too Many Requests"), key);
    }
    await CircuitBreakerStateModel.updateOne(
      { key: docKey },
      { $set: { lastFailureTime: Date.now() - 200_000 } },
    );

    const after = newProcess();
    expect(await after.canExecute(key)).toBe(true);
    expect(await after.getState(key)).toBe(CircuitBreakerState.HALF_OPEN);

    await after.recordSuccess(key);
    expect(await after.getState(key)).toBe(CircuitBreakerState.CLOSED);
    const doc = await CircuitBreakerStateModel.findOne({ key: docKey }).lean();
    expect(doc?.failureCount).toBe(0);
  });

  it("fails open when the state store is unreachable", async () => {
    const cb = TransformerCircuitBreaker.getInstance();
    for (let i = 0; i < 3; i++) {
      await cb.recordFailure(new Error("429 Too Many Requests"), key);
    }
    expect(await cb.canExecute(key)).toBe(false);

    const realFindOne = CircuitBreakerStateModel.findOne;
    const realUpdateOne = CircuitBreakerStateModel.updateOne;
    (CircuitBreakerStateModel as any).findOne = () => {
      throw new Error("mongo down");
    };
    (CircuitBreakerStateModel as any).updateOne = () => {
      throw new Error("mongo down");
    };

    try {
      // A breaker that cannot read its own state must not block transforms,
      // and must not throw out of the bookkeeping calls either.
      const blind = newProcess();
      expect(await blind.canExecute(key)).toBe(true);
      await blind.recordFailure(new Error("boom"), key);
      await blind.recordSuccess(key);
    } finally {
      (CircuitBreakerStateModel as any).findOne = realFindOne;
      (CircuitBreakerStateModel as any).updateOne = realUpdateOne;
    }
  });

  it("reopens when the half-open trial fails", async () => {
    const cb = TransformerCircuitBreaker.getInstance();
    for (let i = 0; i < 3; i++) {
      await cb.recordFailure(new Error("429 Too Many Requests"), key);
    }
    await CircuitBreakerStateModel.updateOne(
      { key: docKey },
      { $set: { lastFailureTime: Date.now() - 200_000 } },
    );

    const after = newProcess();
    expect(await after.canExecute(key)).toBe(true); // -> HALF_OPEN
    await after.recordFailure(new Error("still down"), key);
    expect(await after.getState(key)).toBe(CircuitBreakerState.OPEN);
  });
});

describe.skipIf(!mongoUp)("Transformer refuses to emit an incomplete invoice", () => {
  const tenantId = "hardfail-tenant";
  const key = { tenantId, provider: "openai" };

  // A required field nothing can derive, so missingFields is never empty.
  const firsSchema: any[] = [
    {
      field_id: "f1",
      field_path: "totally_unfillable_field",
      data_type: "string",
      is_required: true,
    },
  ];
  const invoice = {
    invoice_reference: "INV-RETRY-1",
    customer_name: "Probe Ltd",
    invoice_line: [{ description: "Item", quantity: 1, price: 1000 }],
  };
  const authContext: any = {
    tenantId,
    businessId: "BIZ",
    businessTIN: "1-1",
    businessName: "Probe",
  };

  const transform = () =>
    new FIRSInvoiceTransformerV2("fake_key", "http://localhost", "openai", "gpt-4o-mini")
      .transformInvoice(invoice, authContext, [], firsSchema, [], FIRSInvoiceSchema);

  // The hard-fail path is only defined when an LLM is actually available, and
  // tests/ai-toggle.test.ts mutates this shared config without restoring it,
  // so pin it here rather than depending on test file ordering.
  let savedAi: { enabled: boolean; openaiEnabled: boolean } | undefined;

  beforeEach(async () => {
    await CircuitBreakerStateModel.deleteMany({});
    newProcess();
    if (aiConfig) {
      savedAi ??= {
        enabled: aiConfig.enabled,
        openaiEnabled: (aiConfig as any).openaiEnabled,
      };
      aiConfig.enabled = true;
      (aiConfig as any).openaiEnabled = true;
    }
  });

  afterAll(async () => {
    await CircuitBreakerStateModel.deleteMany({});
    if (aiConfig && savedAi) {
      aiConfig.enabled = savedAi.enabled;
      (aiConfig as any).openaiEnabled = savedAi.openaiEnabled;
    }
  });

  it("fails with an actionable error while the breaker is open", async () => {
    const cb = TransformerCircuitBreaker.getInstance();
    for (let i = 0; i < 3; i++) {
      await cb.recordFailure(new Error("429 Too Many Requests"), key);
    }
    expect(await cb.canExecute(key)).toBe(false);

    const res: any = await transform();
    expect(res.success).toBe(false);
    expect(String(res.error)).toContain("circuit breaker OPEN");
    expect(String(res.error)).toContain("totally_unfillable_field");
    expect(String(res.error)).toMatch(/retry in ~\d+s/);
    expect(res.originalInvoice.invoice_reference).toBe("INV-RETRY-1");
  });

  it("does not hard-fail while the breaker is closed", async () => {
    const cb = TransformerCircuitBreaker.getInstance();
    expect(await cb.canExecute(key)).toBe(true);

    const res: any = await transform();
    expect(res.success).toBe(true);
  });
});

afterAll(async () => {
  if (mongoUp && ownsConnection) await mongoose.disconnect();
});
