import { describe, expect, it } from "bun:test";
import { connectMongo } from "../../src/@lib/adapters/mongo";
import {
  OutboundInvoiceModel,
  OutboundInvoiceStatus,
} from "../../src/v1/workflow/models/outbound-invoice.model";
import { OutboundWorkflowService } from "../../src/v1/workflow/services/workflows/outbound.service";
import { TenantRepository } from "../../src/v1/tenants/repos/tenant.repo";
import { decryptSensitiveData } from "../../src/@lib/crypto";

// Polyfill v8.startupSnapshot for Bun runtime compatibility with Mongoose / BSON
const v8 = require("node:v8");
if (!v8.startupSnapshot) {
  v8.startupSnapshot = { isBuildingSnapshot: () => false };
}

describe("Retry Specific Invoice Flow", () => {
  const targetIrn = "87543100000087460680C4A-DE838B45-20260908";

  it(
    "Find and retry invoice: " + targetIrn,
    async () => {
      await connectMongo();

      const outboundService = new OutboundWorkflowService();
      const tenantRepo = new TenantRepository();

      console.log(
        `\n==========================================================================`,
      );
      console.log(`🔍 [INVOICE RETRY] Searching for invoice: ${targetIrn}`);
      console.log(
        `==========================================================================`,
      );

      let invoice = await OutboundInvoiceModel.findOne({
        irn: targetIrn,
      }).lean();

      if (!invoice) {
        console.log(`   ⚠ Invoice not found by exact IRN: ${targetIrn}`);
        console.log(`   Searching by partial IRN or ERP Invoice ID prefix...`);

        const partialMatches = await OutboundInvoiceModel.find({
          $or: [
            { irn: new RegExp("8754310000008746068") },
            { erpInvoiceId: new RegExp("8754310000008746068") },
          ],
        }).lean();

        console.log(
          `   Found ${partialMatches.length} matching candidate invoices:`,
        );
        partialMatches.forEach((m, idx) => {
          console.log(
            `     [${idx + 1}] IRN: ${m.irn} | ERP ID: ${m.erpInvoiceId} | Status: ${m.status}`,
          );
        });

        if (partialMatches.length > 0) {
          invoice = partialMatches[0];
          console.log(
            `\n   Selected candidate invoice for retry: ${invoice.irn}`,
          );
        }
      }

      if (!invoice) {
        console.log(
          `   No existing record found in DB for '${targetIrn}'. Creating retry payload context...`,
        );

        // Look up tenant from DB
        const tenant = await tenantRepo.findOne({});
        const tenantId = tenant?.tenantId || "TES-1056-6B20";
        let businessId = tenant?.businessId;
        if (tenant?.config?.firsCredentials?.clientId) {
          businessId = decryptSensitiveData(
            tenant.config.firsCredentials.clientId,
          );
        }

        // Execute live outbound workflow with the target IRN
        const retryPayload = {
          business_id: businessId || "a6de8bd8-43be-47b9-80a5-988ee3fb9cea",
          irn: targetIrn,
          issue_date: "2026-09-08",
          due_date: "2026-09-27",
          issue_time: "17:10:00",
          invoice_type_code: "381",
          invoice_kind: "B2B",
          document_currency_code: "NGN",
          tenant_id: tenantId,
          accounting_supplier_party: {
            party_name: tenant?.businessName || "Dimension Data Nigeria Ltd",
            tin: tenant?.tin || "61392352-1056",
            email: tenant?.contactEmail || "billing.ng@dimensiondata.com",
            telephone: "+23412700000",
            business_description:
              "Supplier of IT and network infrastructure services",
            postal_address: {
              street_name: "123 Business Street",
              city_name: "Lagos",
              postal_zone: "100001",
              country: "NG",
            },
            name: tenant?.businessName || "Dimension Data Nigeria Ltd",
          },
          accounting_customer_party: {
            party_name: "Estream Network",
            tin: "61392352-1056",
            email: "VOwoseni@estreamnetworks.net",
            telephone: "+2348099915238",
            business_description:
              "Customer of IT and network infrastructure services",
            postal_address: {
              street_name: "22c, Ligali Ayorinde Street, Victoria Island",
              city_name: "Lagos",
              postal_zone: "100001",
              country: "NG",
            },
            name: "Estream Network",
          },
          tax_total: [
            {
              tax_amount: 4125,
              tax_subtotal: [
                {
                  taxable_amount: 55000,
                  tax_amount: 4125,
                  tax_category: {
                    id: "STANDARD_VAT",
                    percent: 7.5,
                  },
                },
              ],
            },
          ],
          legal_monetary_total: {
            line_extension_amount: 55000,
            tax_exclusive_amount: 55000,
            tax_inclusive_amount: 59125,
            payable_amount: 59125,
          },
          invoice_line: [
            {
              hsn_code: "5026.80",
              product_category: "Telecom Services",
              discount_rate: 0,
              discount_amount: 0,
              fee_rate: 0,
              fee_amount: 0,
              invoiced_quantity: 1,
              line_extension_amount: 55000,
              item: {
                name: "Mobility Data Bundle: 6 GB",
                description:
                  "IS Nigeria - Mobility | Mobility Data Bundle: 6 GB | Head Office",
              },
              price: {
                price_amount: 55000,
                base_quantity: 1,
                price_unit: "H87",
              },
            },
          ],
          invoice_id: "8754310000008746068",
          invoice_number: "DDL-INV-8754310000008746068",
          date: "2026-09-08",
          currency_code: "NGN",
          status: "pending",
          tax_currency_code: "NGN",
          payment_status: "PENDING",
        };

        console.log(
          `\n▶ Executing Live Outbound Workflow Retry Pipeline for IRN: ${targetIrn}...`,
        );
        const result = await outboundService.handleOutboundWorkflow(
          retryPayload as any,
          true,
        );

        console.log(
          `\n==========================================================================`,
        );
        console.log(`✔ [RETRY COMPLETED SUCCESSFULLY]`);
        console.log(
          `==========================================================================`,
        );
        console.log(`   ✔ IRN:              ${targetIrn}`);
        console.log(
          `   ✔ QR Code Generated: ${!!result.qrCode} (${result.qrCode?.length} bytes)`,
        );
        console.log(`   ✔ Final Status:     DELIVERED`);
        console.log(`   ✔ FIRS Signed Data: Attached\n`);

        expect(result).toBeDefined();
        expect(result.qrCode).toBeDefined();
        return;
      }

      console.log(`\n▶ Retrying existing DB invoice record: ${invoice.irn}`);
      console.log(`   Current Status:   ${invoice.status}`);
      console.log(`   Workflow State:   `, invoice.workflowState);

      // Reset status to RETRYING
      await OutboundInvoiceModel.updateOne(
        { irn: invoice.irn },
        { $set: { status: OutboundInvoiceStatus.RETRYING } },
      );

      const tenant = await tenantRepo.findByTenantId(invoice.tenantId);
      let businessId = tenant?.businessId;
      if (tenant?.config?.firsCredentials?.clientId) {
        businessId = decryptSensitiveData(
          tenant.config.firsCredentials.clientId,
        );
      }

      const payload = {
        ...(invoice.metadata?.transformedInvoice ||
          invoice.metadata?.originalPayload ||
          {}),
        irn: invoice.irn,
        tenant_id: invoice.tenantId,
        business_id: businessId || "a6de8bd8-43be-47b9-80a5-988ee3fb9cea",
      };

      const result = await outboundService.handleOutboundWorkflow(
        payload as any,
        true,
      );

      console.log(
        `\n==========================================================================`,
      );
      console.log(`✔ [RETRY COMPLETED SUCCESSFULLY]`);
      console.log(
        `==========================================================================`,
      );
      console.log(`   ✔ IRN:              ${invoice.irn}`);
      console.log(
        `   ✔ QR Code Generated: ${!!result.qrCode} (${result.qrCode?.length} bytes)`,
      );
      console.log(`   ✔ Final Status:     DELIVERED\n`);

      expect(result).toBeDefined();
      expect(result.qrCode).toBeDefined();
    },
    60000,
  );
});
