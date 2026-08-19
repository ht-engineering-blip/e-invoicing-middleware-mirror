import { beforeAll, describe, expect, it } from "bun:test";
import { connectMongo } from "../src/@lib/adapters/mongo";
import { TenantModel } from "../src/v1/tenants/models/tenant.model";
import { TenantService } from "../src/v1/tenants/services/tenant.service";

describe("Tenant Email Verification Flow", () => {
  let tenantId: string;
  let oldEmail: string;
  let testNewEmail: string;
  let tenantService: TenantService;
  let tenant: any;

  beforeAll(async () => {
    await connectMongo();
    tenant = await TenantModel.findOne({}).lean();
    if (tenant) {
      tenantId = tenant.tenantId;
      oldEmail = tenant.contactEmail;
      testNewEmail = `test-verify-${Date.now()}@example.com`;
      tenantService = new TenantService();
    }
  }, 20000);

  it("should block direct email update without verification", async () => {
    if (!tenant) return;
    expect(
      tenantService.updateTenant(
        tenantId,
        { contactEmail: testNewEmail },
        { type: "user", id: tenantId },
      ),
    ).rejects.toThrow();
  });

  it("should request email change and verify via token", async () => {
    if (!tenant) return;
    const reqRes = await tenantService.requestEmailChange(
      tenantId,
      testNewEmail,
      { type: "user", id: tenantId },
    );
    expect(reqRes.message).toBeDefined();

    // Invalid token should fail
    expect(
      tenantService.verifyEmailChange(tenantId, "invalid-token-here"),
    ).rejects.toThrow();

    // Valid token
    const validToken = await tenantService.createAuthToken(
      {
        ...tenant,
        contactEmail: testNewEmail,
        newEmail: testNewEmail,
      },
      "12HRS",
    );

    const verifyRes = await tenantService.verifyEmailChange(
      tenantId,
      validToken,
    );
    expect(verifyRes.message).toBeDefined();

    // Revert back
    await TenantModel.updateOne(
      { tenantId },
      { $set: { contactEmail: oldEmail } },
    );
  }, 20000);
});
