import { describe, expect, it } from "bun:test";
import {
  sanitizeInvoicePayload,
  autoFixInvoiceFromFIRSError,
  retryWithAutoFix,
} from "../src/v1/workflow/utils/invoice-sanitizer.util";

describe("FIRS Schema 1.1 Sanitizer & Self-Healing Engine Unit Tests", () => {
  it("should sanitize raw ERP invoice and enforce all mandatory FIRS 1.1 fields", () => {
    const rawPayload = {
      data: {
        business_id: "10aa4768-917b-4800-835d-2d0811f9e9bd",
        irn: "886/N-408/22-763C917B-20260830",
        issue_date: "2026-08-30",
        invoice_type_code: "380",
        invoice_kind: "B2B",
        accounting_supplier_party: {
          tin: "01621734-0001",
          party_name: "Hydrodive Nigeria Limited",
          postal_address: {
            street_name: "17,WHARF ROAD,",
            city_name: "APAPA",
            postal_zone: "102272",
            country: "Nigeria",
          },
        },
        accounting_customer_party: {
          tin: "987654321",
          party_name: "Arkad Oil & Gas Limited",
          postal_address: {
            street_name: "Block 2, House 1",
            city_name: "Rivers State",
          },
        },
        invoice_line: [
          {
            item: {
              name: "Consulting Services",
              description: "",
            },
            price: {
              price_unit: "NGN per 1",
              price_amount: "200000",
            },
            invoiced_quantity: "1",
            tax_amount: "15000",
            tax_rate: "7.5",
          },
        ],
        tax_total: [
          {
            tax_amount: "15000",
            tax_subtotal: [
              {
                taxable_amount: "200000",
                tax_amount: "15000",
                tax_category: {
                  id: "LOCAL_SALES_TAX",
                  percent: "7.5",
                },
              },
            ],
          },
        ],
      },
    };

    const sanitized = sanitizeInvoicePayload(rawPayload);

    // 1. Root & IRN
    expect(sanitized.document_currency_code).toBe("NGN");
    expect(sanitized.irn).toMatch(/^[A-Z0-9]+-[A-Z0-9]{8}-20260830$/);
    expect((sanitized.irn as string).includes("/")).toBe(false);

    // 2. Supplier & Customer addresses
    const supAddress = (sanitized.accounting_supplier_party as any).postal_address;
    expect(supAddress.country).toBe("NG");

    const custAddress = (sanitized.accounting_customer_party as any).postal_address;
    expect(custAddress.country).toBe("NG");
    expect(custAddress.postal_zone).toBe("100001");

    // 3. Line Items
    const line = (sanitized.invoice_line as any[])[0];
    expect(line.item.name).toBe("Consulting Services");
    expect(line.item.description).toBe("Consulting Services");
    expect(line.price.price_amount).toBe(200000);
    expect(line.price.price_unit).toBe("H87");
    expect(line.price.base_quantity).toBe(1);
    expect(line.hsn_code).toMatch(/^\d{4}\.\d{2}$/);

    // 4. Tax Category Normalization
    const taxSubtotal = (sanitized.tax_total as any[])[0].tax_subtotal[0];
    expect(taxSubtotal.tax_category.id).toBe("STANDARD_VAT");
    expect(taxSubtotal.tax_category.percent).toBe(7.5);

    // 5. Legal Monetary Totals
    const lmt = sanitized.legal_monetary_total as any;
    expect(lmt.line_extension_amount).toBe(200000);
    expect(lmt.tax_exclusive_amount).toBe(200000);
    expect(lmt.tax_inclusive_amount).toBe(215000);
    expect(lmt.payable_amount).toBe(215000);
  });

  it("should auto-heal FIRS rejection errors with autoFixInvoiceFromFIRSError", () => {
    const invalidInvoice = {
      irn: "INV001-8593BD6E-20260830",
      business_id: "BIZ-TEST",
      accounting_supplier_party: { party_name: "Sup", tin: "01621734-0001" },
      accounting_customer_party: { party_name: "Cust", tin: "01621734-0002" },
      tax_total: [
        {
          tax_amount: 75,
          tax_subtotal: [
            {
              tax_amount: 75,
              taxable_amount: 1000,
              tax_category: { id: "INVALID_TAX_ID", percent: 7.5 },
            },
          ],
        },
      ],
      invoice_line: [
        {
          item: { name: "Web Hosting", description: "" },
          price: { price_amount: "5000", price_unit: "NGN per unit" },
        },
      ],
    };

    // Auto fix tax category error
    const healed1 = autoFixInvoiceFromFIRSError(
      invalidInvoice,
      "invoicerequest.invoice.taxtotal[0].taxsubtotal[0].taxcategory.id must be a valid tax category",
    );
    expect((healed1.tax_total as any[])[0].tax_subtotal[0].tax_category.id).toBe("STANDARD_VAT");

    // Auto fix item description error
    const healed2 = autoFixInvoiceFromFIRSError(
      invalidInvoice,
      "invoicerequest.invoice.invoiceline[0].item.description is required",
    );
    expect((healed2.invoice_line as any[])[0].item.description).toBe("Web Hosting");

    // Auto fix price unit error
    const healed3 = autoFixInvoiceFromFIRSError(
      invalidInvoice,
      "invoicerequest.invoice.invoiceline[0].price.priceunit can not be more than in length or value 3",
    );
    expect((healed3.invoice_line as any[])[0].price.price_unit).toBe("H87");

    // Auto fix IRN template error
    const healed4 = autoFixInvoiceFromFIRSError(
      invalidInvoice,
      "irn validation failed for this business, refer to the template and try again",
    );
    expect(healed4.irn).toMatch(/^[A-Z0-9]+-[A-Z0-9]{8}-[0-9]{8}$/);
  });

  it("should retry and succeed using retryWithAutoFix", async () => {
    let attempts = 0;
    const testInvoice = {
      irn: "INV-TEST-8593BD6E-20260830",
      business_id: "BIZ-TEST",
      accounting_supplier_party: { party_name: "Sup", tin: "01621734-0001" },
      accounting_customer_party: { party_name: "Cust", tin: "01621734-0002" },
      invoice_line: [
        {
          item: { name: "Software Subscription", description: "" },
          price: { price_amount: 1000, price_unit: "H87" },
        },
      ],
      tax_total: [
        {
          tax_amount: 75,
          tax_subtotal: [
            {
              tax_amount: 75,
              taxable_amount: 1000,
              tax_category: { id: "CUSTOM_TAX", percent: 7.5 },
            },
          ],
        },
      ],
    };

    const mockFIRSCall = async (inv: Record<string, unknown>) => {
      attempts++;
      const taxCat = (inv.tax_total as any[])?.[0]?.tax_subtotal?.[0]?.tax_category?.id;
      if (attempts === 1 || taxCat === "CUSTOM_TAX") {
        throw new Error("invoicerequest.invoice.taxtotal[0].taxsubtotal[0].taxcategory.id must be a valid tax category");
      }
      return { code: 200, message: "Signed successfully", data: { ok: true } };
    };

    const result = await retryWithAutoFix(mockFIRSCall, testInvoice, { maxRetries: 3, initialDelayMs: 10 });
    expect(result.code).toBe(200);
    expect(attempts).toBe(2); // First failed, auto-healed taxcategory, second attempt succeeded!
  });
});
