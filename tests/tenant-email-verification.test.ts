import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { connectMongo } from "../src/@lib/adapters/mongo";
import { TenantModel, TenantStatus } from "../src/v1/tenants/models/tenant.model";
import { TenantService } from "../src/v1/tenants/services/tenant.service";

describe("Tenant Email Verification Flow", () => {
  let tenantId: string;
  let testEmail: string;
  let testNewEmail: string;
  let tenantService: TenantService;
  let tenant: any;

  beforeAll(async () => {
    await connectMongo();
    tenantService = new TenantService();
    tenantId = `TEST-VERIFY-${Date.now()}`;
    testEmail = `test-initial-${Date.now()}@example.com`;
    testNewEmail = `test-verify-${Date.now()}@example.com`;

    // Create an isolated temporary tenant for this test
    tenant = await TenantModel.create({
      tenantId,
      businessName: "Test Verification Tenant",
      tin: "1234567890",
      businessRegistrationNumber: "RC-999999",
      contactEmail: testEmail,
      contactPhone: "+2348000000000",
      status: TenantStatus.ACTIVE,
    });
  }, 20000);

  afterAll(async () => {
    // Clean up temporary tenant
    if (tenantId) {
      await TenantModel.deleteOne({ tenantId });
    }
  });

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
        ...tenant.toObject(),
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
  }, 20000);
});
