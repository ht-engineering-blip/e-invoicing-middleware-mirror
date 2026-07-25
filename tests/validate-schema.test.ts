import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { connectMongo } from "../src/@lib/adapters/mongo";
import { TransformWorkflowService } from "../src/v1/workflow/services";
import { FIRSService } from "../src/@lib/adapters/firs/firs.service";
import mongoose from "mongoose";
import crypto from "crypto";

describe("FIRS Invoice Type Integration and Validation", () => {
  beforeAll(async () => {
    await connectMongo();
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  it("should transform invoice_type_code 380 to 396 and validate successfully against FIRS", async () => {
    const uniqueId = crypto.randomUUID();
    const uniqueRef = "882-D-701-" + Math.floor(Math.random() * 1000000);
    // Sanitize the invoice number by removing non-alphanumeric characters for IRN prefix
    const sanitizedRef = uniqueRef.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    const correctIrn = `${sanitizedRef}-34A843BE-20260725`;

    const rawPayload = {
      business_id: "a6de8bd8-43be-47b9-80a5-988ee3fb9cea",
      irn: correctIrn,
      issue_date: "2026-07-25T00:00:00.000Z",
      invoice_type_code: "380",
      invoice_kind: "B2B",
      payment_status: "PENDING",
      document_currency_code: "NGN",
      accounting_supplier_party: {
        tin: "61392352-1056",
        email: "send.info@okeketech.com",
        telephone: "+2348012345678",
        party_name: "Heirs Technologies Limited",
        postal_address: {
          state: "Lagos",
          country: "NG",
          city_name: "Lagos",
          postal_zone: "1234567",
          street_name: "123 Business Street",
        },
        business_description: "Venture into wood making",
      },
      accounting_customer_party: {
        tin: "1234567893",
        email: "Precious.Iwuala@gmail.com",
        telephone: "+2348163565148",
        party_name: "Emekason And Sons Limited",
        postal_address: {
          country: "NG",
          city_name: "Apapa-NG-LA",
          postal_zone: "",
          street_name: "24/74, Uzor Street.",
        },
        business_description: "Import",
      },
      legal_monetary_total: {
        line_extension_amount: 25000000,
        tax_exclusive_amount: 25000000,
        tax_inclusive_amount: 26875000,
        payable_amount: 26875000,
      },
      invoice_line: [
        {
          item: {
            name: "Digital marketing with the aid of ultramodern tools and skills",
            description: "",
            sellers_item_identification: "",
          },
          price: {
            price_unit: "NGN per 1",
            price_amount: "25000000",
            base_quantity: 1,
            currency_code: null,
            original_price_amount: null,
          },
          item_id: "3aba6c74-af56-4b5d-9c7e-06324bed817f",
          fee_rate: "0",
          hsn_code: "8471.00",
          tax_rate: "7.50",
          is_credit: false,
          isic_code: "",
          fee_amount: "0",
          tax_amount: "1875000",
          tax_category: "LOCAL_SALES_TAX",
          currency_code: "NGN",
          discount_rate: "0",
          exchange_rate: "1",
          discount_amount: "0",
          tax_category_id: "e1e57015-28e5-479b-a896-ef5781d49af8",
          product_category: "",
          service_category: "",
          invoiced_quantity: 1,
          exchange_rate_date: "2026-07-25T00:00:00.000Z",
          original_line_amount: "25000000",
          line_extension_amount: "25000000",
          exchange_rate_requested_date: "2026-07-25T00:00:00.000Z",
        },
      ],
      due_date: "2026-08-24T00:00:00.000Z",
      tax_currency_code: "NGN",
      bank_accounts: [
        {
          id: "4088e9ba-4cdd-4ea9-9067-0fa1d7b322af",
          label: "NGN Account",
          branch: "",
          bank_name: "UBA",
          account_name: "Okeke Technologies Ltd",
          extra_fields: [],
          account_number: "1238592517",
          account_country: "NG",
        },
      ],
      signatories: [
        {
          id: "0fdce9e9-3151-4f96-9410-ca597395aef5",
          name: "John Smith",
          title: "CFO",
          is_primary: true,
          signature_url: "https://tinyurl.com/4u3stbn7",
        },
      ],
      tax_total: [
        {
          tax_amount: 1875000,
          tax_subtotal: [
            {
              tax_amount: 1875000,
              tax_category: {
                id: "LOCAL_SALES_TAX",
                percent: 7.5,
                tax_category_id: "e1e57015-28e5-479b-a896-ef5781d49af8",
              },
              taxable_amount: 25000000,
            },
          ],
        },
      ],
      event: "erp.invoice.submitted",
      eventType: "erp.invoice.submitted",
      timestamp: "2026-07-25T10:31:02.617Z",
      webhook_id: "d19135e9-1a34-4493-953a-4dc8dd4d8f14",
      tenant_id: "63e829e4-0e80-42c1-8c08-29dab44b51a0",
      invoice_id: uniqueId,
      invoice_number: uniqueRef,
      status: "PENDING",
      nrs_validated: false,
    };

    const authContext: any = {
      tenantId: "TES-1056-6B20",
      businessId: "a6de8bd8-43be-47b9-80a5-988ee3fb9cea",
      businessName: "Heirs Technologies Limited",
      businessTIN: "61392352-1056",
      serviceId: "34A843BE",
      isAdmin: false,
      scopes: ["*"],
    };

    const transformService = new TransformWorkflowService();
    const firsService = new FIRSService();

    const transformed = await transformService.transformInvoiceV2(
      rawPayload,
      authContext,
      "TALLY_ERP",
    );

    // Verify it transformed code 380 (ERP Commercial Invoice) to 396 (FIRS Invoice Request)
    expect(transformed.invoice_type_code).toBe("396");

    // Verify it successfully validates against FIRS staging API
    const response = await firsService.validateInvoice(
      authContext.tenantId,
      transformed,
    );
    expect(response.code).toBe(200);
    expect(response.data?.ok).toBe(true);
  }, 30000);
});
