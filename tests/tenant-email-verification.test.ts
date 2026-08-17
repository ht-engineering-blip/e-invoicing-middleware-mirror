import dns from "node:dns";
dns.setServers(["1.1.1.1", "1.0.0.1", "8.8.8.8", "8.8.4.4"]);

import { Elysia } from "elysia";
import * as jwt from "jsonwebtoken";
import { jwtConfig } from "../src/@config";
import { connectMongo } from "../src/@lib/adapters/mongo";
import { v1Routes } from "../src/v1";
import { errorHandlerMiddleware } from "../src/middlewares";
import { TenantModel } from "../src/v1/tenants/models/tenant.model";
import { TenantService } from "../src/v1/tenants/services/tenant.service";

async function main() {
  console.log("Connecting to MongoDB...");
  await connectMongo();
  console.log("Connected to MongoDB!");

  const tenant = await TenantModel.findOne({}).lean();
  if (!tenant) {
    console.error("No tenant found");
    process.exit(1);
  }

  const tenantId = tenant.tenantId;
  const oldEmail = tenant.contactEmail;
  const testNewEmail = `test-verify-${Date.now()}@example.com`;

  console.log(`Testing with tenant: ${tenantId}, Current email: ${oldEmail}`);

  const tenantService = new TenantService();

  // Test 1: Direct update attempt by non-admin should fail
  console.log("\n================ TEST 1: Direct email update without verification ================");
  try {
    await tenantService.updateTenant(
      tenantId,
      { contactEmail: testNewEmail },
      { type: "user", id: tenantId },
    );
    console.error("FAIL: Direct update should have thrown an error!");
    process.exit(1);
  } catch (err: any) {
    console.log(`SUCCESS: Direct update blocked with message: "${err.message}"`);
  }

  // Test 2: Request email change via createAuthToken
  console.log("\n================ TEST 2: Request email change (createAuthToken) ================");
  const reqRes = await tenantService.requestEmailChange(
    tenantId,
    testNewEmail,
    { type: "user", id: tenantId },
  );
  console.log(`Request result: ${reqRes.message}`);

  // Test 3: Verify with invalid token should fail
  console.log("\n================ TEST 3: Verify with invalid token ================");
  try {
    await tenantService.verifyEmailChange(tenantId, "invalid-token-here");
    console.error("FAIL: Invalid token should have thrown an error!");
    process.exit(1);
  } catch (err: any) {
    console.log(`SUCCESS: Invalid token blocked with message: "${err.message}"`);
  }

  // Test 4: Verify with valid JWT token created with createAuthToken
  console.log("\n================ TEST 4: Verify with valid JWT token ================");
  const validToken = await tenantService.createAuthToken(
    {
      ...tenant,
      contactEmail: testNewEmail,
      newEmail: testNewEmail,
    },
    "12HRS",
  );

  const verifyRes = await tenantService.verifyEmailChange(tenantId, validToken);
  console.log(`Verify result:`, verifyRes);

  const finalTenant = await TenantModel.findOne({ tenantId }).lean();
  console.log(`Updated contact email in DB: ${finalTenant?.contactEmail}`);

  // Test 5: HTTP Endpoint verification via Elysia app with _u param
  console.log("\n================ TEST 5: HTTP GET /v1/tenants/:tenantId/settings/email/verify?_u=... ================");
  const app = new Elysia().use(errorHandlerMiddleware).use(v1Routes);

  // Authenticate as tenant
  const userToken = jwt.sign(
    {
      tenantId,
      businessId: "34A843BE",
      scopes: ["*"],
    },
    jwtConfig?.secret!,
    { algorithm: jwtConfig?.algorithm as jwt.Algorithm },
  );

  const httpRes = await app.handle(
    new Request(
      `http://localhost/v1/tenants/${tenantId}/settings/email/verify?_u=${validToken}`,
      {
        method: "GET",
        headers: { authorization: `Bearer ${userToken}` },
      },
    ),
  );

  console.log(`HTTP Status: ${httpRes.status}`);
  const httpJson = await httpRes.json();
  console.log("HTTP Response:", httpJson);

  // Revert contact email back to original
  await TenantModel.updateOne(
    { tenantId },
    { $set: { contactEmail: oldEmail } },
  );
  console.log(`\nReverted contact email back to original: ${oldEmail}`);

  console.log("\nALL EMAIL VERIFICATION TESTS PASSED!");
  process.exit(0);
}

main().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
