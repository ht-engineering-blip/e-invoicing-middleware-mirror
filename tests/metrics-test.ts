import dns from "node:dns";
dns.setServers(["1.1.1.1", "1.0.0.1", "8.8.8.8", "8.8.4.4"]);

import { Elysia } from "elysia";
import * as jwt from "jsonwebtoken";
import { jwtConfig } from "../src/@config";
import { connectMongo } from "../src/@lib/adapters/mongo";
import { v1Routes } from "../src/v1";
import { errorHandlerMiddleware } from "../src/middlewares";
import { OutboundInvoiceModel } from "../src/v1/workflow/models/outbound-invoice.model";

async function main() {
  console.log("Connecting to MongoDB...");
  await connectMongo();
  console.log("Connected to MongoDB!");

  const sampleInv = await OutboundInvoiceModel.findOne({}).lean();
  const tenantId = sampleInv?.tenantId || "TEST-TENANT";
  const businessId = "34A843BE";

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

  console.log("\n================ TEST 1: GET /v1/workflow/invoices/metrics ================");
  const res1 = await app.handle(
    new Request("http://localhost/v1/workflow/invoices/metrics", {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    }),
  );
  console.log(`Status: ${res1.status}`);
  const json1 = await res1.json();
  console.log("Metrics Response:", JSON.stringify(json1, null, 2));

  console.log("\n================ TEST 2: GET /v1/workflow/invoices (Unified List) ================");
  const res2 = await app.handle(
    new Request("http://localhost/v1/workflow/invoices", {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    }),
  );
  console.log(`Status: ${res2.status}`);
  const json2 = await res2.json();
  console.log(`Success: ${json2.success}, Total: ${json2.pagination?.total}, Items returned: ${json2.data?.length}`);

  process.exit(0);
}

main().catch(err => {
  console.error("Test error:", err);
  process.exit(1);
});
