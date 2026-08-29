import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { aiConfig, isOpenAiEnabled, isAiEnabled } from "../src/@config/ai";
import { FIRSInvoiceTransformer } from "../src/v1/workflow/utils/transformer";
import { FIRSInvoiceTransformerV2 } from "../src/v1/workflow/utils/transformer/v2";

describe("OpenAI / AI Environment Toggle & Strict Error Return Tests", () => {
  let originalOpenAIEnabledEnv: string | undefined;
  let originalAiEnabledEnv: string | undefined;

  beforeAll(() => {
    originalOpenAIEnabledEnv = process.env.OPENAI_ENABLED;
    originalAiEnabledEnv = process.env.AI_ENABLED;
  });

  afterAll(() => {
    process.env.OPENAI_ENABLED = originalOpenAIEnabledEnv;
    process.env.AI_ENABLED = originalAiEnabledEnv;
  });

  it("should correctly evaluate isOpenAiEnabled() helper", () => {
    process.env.OPENAI_ENABLED = "false";
    expect(isOpenAiEnabled()).toBe(false);

    process.env.OPENAI_ENABLED = "true";
    expect(isOpenAiEnabled()).toBe(true);

    process.env.AI_ENABLED = "false";
    expect(isOpenAiEnabled()).toBe(false);
    expect(isAiEnabled()).toBe(false);

    delete process.env.OPENAI_ENABLED;
    delete process.env.AI_ENABLED;
    expect(isOpenAiEnabled()).toBe(true);
    expect(isAiEnabled()).toBe(true);
  });

  it("should fail with explicit 503 error when OpenAI is disabled in FIRSInvoiceTransformer", async () => {
    if (aiConfig) {
      aiConfig.enabled = false;
      aiConfig.openaiEnabled = false;
    }

    const transformer = new FIRSInvoiceTransformer(
      "test-key",
      "https://api.openai.com/v1/chat/completions",
      "openai",
      "gpt-4o-mini",
    );

    const result = await transformer.transformAndValidate({
      invoiceNumber: "INV-TEST-001",
      customer: { name: "Test Customer" },
    });

    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors?.[0]).toContain("OPENAI_ENABLED=false");

    // Restore
    if (aiConfig) {
      aiConfig.enabled = true;
      aiConfig.openaiEnabled = true;
    }
  });

  it("should fail with explicit error when OpenAI is disabled in FIRSInvoiceTransformerV2", async () => {
    if (aiConfig) {
      aiConfig.enabled = false;
      aiConfig.openaiEnabled = false;
    }

    const transformer = new FIRSInvoiceTransformerV2(
      "test-key",
      "https://api.openai.com/v1/chat/completions",
      "openai",
      "gpt-4o-mini",
    );

    // Call transformInvoice directly with minimal schema requiring missing fields
    const mockFirsSchema = [
      { field_id: "f1", field_path: "business_id", data_type: "string", is_required: true },
      { field_id: "f2", field_path: "irn", data_type: "string", is_required: true },
    ];

    const result = await (transformer as any).transformInvoice(
      {
        invoiceNumber: "INV-TEST-002",
        customer: { name: "Test Customer" },
      },
      { tenantId: "test-tenant" },
      [],
      mockFirsSchema,
      [],
      { parse: (x: any) => x },
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(String(result.error)).toContain("OPENAI_ENABLED=false");

    // Restore
    if (aiConfig) {
      aiConfig.enabled = true;
      aiConfig.openaiEnabled = true;
    }
  });
});
