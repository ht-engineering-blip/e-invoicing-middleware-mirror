import { describe, expect, it } from "bun:test";
import FIRSClient from "../src/@lib/adapters/firs/firs.service";
import { extractProviderError } from "../src/v1/workflow/jobs/chain";

/** The shape NRS returned on the 2026-09-06 complete_outbound failure. */
const nrsError: any = {
  config: { url: "api/v1/invoice/validate", method: "post" },
  response: {
    status: 400,
    data: {
      code: 400,
      error: {
        public_message:
          "we are unable to process your request. also confirm this is not a duplicate request",
        details: "unable to complete this operation at this time, kindly try again later",
        id: "req_abc123",
        handler: "InvoiceValidationHandler",
        errors: [{ field: "invoice.irn", message: "already exists" }],
      },
    },
  },
};

describe("upstream error detail survives to the job record", () => {
  it("keeps the flattened message unchanged", async () => {
    const thrown: any = await new FIRSClient()
      ._handleError(nrsError)
      .catch((e: any) => e);
    expect(thrown.message).toBe(
      "we are unable to process your request. also confirm this is not a duplicate request - " +
        "unable to complete this operation at this time, kindly try again later",
    );
  });

  it("carries the fields the message throws away", async () => {
    const thrown: any = await new FIRSClient()
      ._handleError(nrsError)
      .catch((e: any) => e);
    const p = thrown.providerError;

    expect(p.httpStatus).toBe(400);
    expect(p.details).toBe("unable to complete this operation at this time, kindly try again later");
    // These are the parts that previously existed only in stdout.
    expect(p.raw.id).toBe("req_abc123");
    expect(p.raw.handler).toBe("InvoiceValidationHandler");
    expect(p.raw.errors[0].message).toBe("already exists");
    expect(p.url).toBe("api/v1/invoice/validate");
  });

  it("is found by chainFail wherever a job step wrapped it", async () => {
    const thrown: any = await new FIRSClient()
      ._handleError(nrsError)
      .catch((e: any) => e);

    // thrown directly
    expect(extractProviderError(thrown)?.raw).toBeTruthy();
    // re-thrown with the original attached as cause
    const wrapped: any = new Error("Invoice validation failed: ...");
    wrapped.cause = thrown;
    expect((extractProviderError(wrapped) as any)?.raw?.id).toBe("req_abc123");
  });

  it("falls back to the raw body when no providerError was attached", () => {
    const bare: any = { response: { status: 502, data: { message: "bad gateway" } } };
    const p: any = extractProviderError(bare);
    expect(p.httpStatus).toBe(502);
    expect(p.raw.message).toBe("bad gateway");
  });

  it("returns nothing for an ordinary error", () => {
    expect(extractProviderError(new Error("plain"))).toBeUndefined();
  });
});
