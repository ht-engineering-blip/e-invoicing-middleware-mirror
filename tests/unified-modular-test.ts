import "../src/bun-v8-polyfill";
import dns from "node:dns";
dns.setServers(["1.1.1.1", "1.0.0.1", "8.8.8.8", "8.8.4.4"]);

import { Elysia } from "elysia";
import * as jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { appConfig, databaseConfig, jwtConfig } from "../src/@config";
import { connectMongo } from "../src/@lib/adapters/mongo";
import { v1Routes } from "../src/v1";
import { errorHandlerMiddleware } from "../src/middlewares";
import { OutboundInvoiceModel } from "../src/v1/workflow/models/outbound-invoice.model";
import { InboundInvoiceModel } from "../src/v1/workflow/models/inbound-invoice.model";
import { TenantModel } from "../src/v1/tenants/models/tenant.model";

async function main() {
  console.log("Connecting to MongoDB...");
  await connectMongo();
  console.log("Connected to MongoDB!");

  const sampleInv = await OutboundInvoiceModel.findOne({}).lean();
  console.log("Sample invoice tenantId:", sampleInv?.tenantId);
  const tenantId = sampleInv?.tenantId || "TEST-TENANT";
  const businessId = "34A843BE";

  // Create JWT token matching user's auth
  const token = jwt.sign(
    {
      tenantId,
      businessId,
      scopes: ["*"],
    },
    jwtConfig?.secret!,
    { algorithm: jwtConfig?.algorithm as jwt.Algorithm },
  );

  const app = new Elysia().use(errorHandlerMiddleware).use(v1Routes);

  console.log("\n================ TEST 1: GET /v1/workflow/invoices (Unified) ================");
  const res1 = await app.handle(
    new Request("http://localhost/v1/workflow/invoices", {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    }),
  );
  console.log(`Status: ${res1.status}`);
  const json1 = await res1.json();
  console.log(`Success: ${json1.success}, Total: ${json1.pagination?.total}, Items returned: ${json1.data?.length}`);

  console.log("\n================ TEST 2: GET /v1/workflow/invoices/outbound ================");
  const res2 = await app.handle(
    new Request("http://localhost/v1/workflow/invoices/outbound", {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    }),
  );
  console.log(`Status: ${res2.status}`);
  const json2 = await res2.json();
  console.log(`Success: ${json2.success}, Total: ${json2.pagination?.total}, Items returned: ${json2.data?.length}`);

  console.log("\n================ TEST 3: GET /v1/workflow/invoices/inbound ================");
  const res3 = await app.handle(
    new Request("http://localhost/v1/workflow/invoices/inbound", {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    }),
  );
  console.log(`Status: ${res3.status}`);
  const json3 = await res3.json();
  console.log(`Success: ${json3.success}, Total: ${json3.pagination?.total}, Items returned: ${json3.data?.length}`);

  console.log("\n================ TEST 4: GET /v1/workflow/invoices?type=outbound ================");
  const res4 = await app.handle(
    new Request("http://localhost/v1/workflow/invoices?type=outbound", {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    }),
  );
  console.log(`Status: ${res4.status}`);
  const json4 = await res4.json();
  console.log(`Success: ${json4.success}, Total: ${json4.pagination?.total}, Items returned: ${json4.data?.length}`);

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL SCRIPT ERROR:", err);
  process.exit(1);
});
