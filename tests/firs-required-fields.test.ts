import { describe, expect, it } from "bun:test";
import { sanitizeInvoicePayload } from "../src/v1/workflow/utils/invoice-sanitizer.util";

const isNum = (v: unknown) => typeof v === "number" && Number.isFinite(v);

describe("FIRS required fields are guaranteed before send", () => {
  describe("legal_monetary_total", () => {
    it("is derived from the lines when absent entirely", () => {
      // "legalmonetarytotal.lineextensionamount is required"
      const out: any = sanitizeInvoicePayload({
        irn: "A",
        invoice_line: [
          { item: { name: "X" }, invoiced_quantity: 2, price: { price_amount: 50 } },
        ],
      });
      expect(out.legal_monetary_total.line_extension_amount).toBe(100);
      for (const f of [
        "line_extension_amount",
        "tax_exclusive_amount",
        "tax_inclusive_amount",
        "payable_amount",
      ]) {
        expect(isNum(out.legal_monetary_total[f])).toBe(true);
      }
    });

    it("coerces numeric strings to numbers", () => {
      const out: any = sanitizeInvoicePayload({
        irn: "B",
        legal_monetary_total: {
          line_extension_amount: "150000",
          tax_exclusive_amount: "150000",
          tax_inclusive_amount: "161250",
          payable_amount: "161250",
        },
      });
      expect(out.legal_monetary_total.line_extension_amount).toBe(150000);
      expect(out.legal_monetary_total.payable_amount).toBe(161250);
    });
  });

  describe("party fields", () => {
    it("replaces a TIN shorter than 5 characters", () => {
      // "accountingcustomerparty.tin must be at least in length or value 5"
      const out: any = sanitizeInvoicePayload({
        irn: "C",
        accounting_customer_party: { party_name: "Cust", tin: "" },
        accounting_supplier_party: { party_name: "Sup", tin: "123" },
      });
      expect(out.accounting_customer_party.tin.length).toBeGreaterThanOrEqual(5);
      expect(out.accounting_supplier_party.tin.length).toBeGreaterThanOrEqual(5);
    });

    it("keeps a valid TIN untouched", () => {
      const out: any = sanitizeInvoicePayload({
        irn: "C2",
        accounting_customer_party: { party_name: "Cust", tin: "00364075-0001" },
      });
      expect(out.accounting_customer_party.tin).toBe("00364075-0001");
    });

    it("gives both parties a business_description of at least 5 characters", () => {
      // "accountingsupplierparty.businessdescription must be at least in length or value 5"
      const out: any = sanitizeInvoicePayload({
        irn: "D",
        accounting_supplier_party: { party_name: "Dimension Data" },
        accounting_customer_party: { party_name: "Test Company" },
      });
      expect(out.accounting_supplier_party.business_description).toContain("Dimension Data");
      expect(out.accounting_supplier_party.business_description.length).toBeGreaterThanOrEqual(5);
      expect(out.accounting_customer_party.business_description.length).toBeGreaterThanOrEqual(5);
    });

    it("keeps a real business_description", () => {
      const out: any = sanitizeInvoicePayload({
        irn: "D2",
        accounting_supplier_party: {
          party_name: "X",
          business_description: "Venture into wood making",
        },
      });
      expect(out.accounting_supplier_party.business_description).toBe("Venture into wood making");
    });

    it("fills the postal address", () => {
      const out: any = sanitizeInvoicePayload({ irn: "E" });
      const addr = out.accounting_supplier_party.postal_address;
      expect(addr.street_name).toBeTruthy();
      expect(addr.city_name).toBeTruthy();
      expect(addr.country).toBe("NG");
    });
  });

  describe("invoice lines", () => {
    it("fills item, price and quantity on a bare line", () => {
      const out: any = sanitizeInvoicePayload({ irn: "F" });
      const line = out.invoice_line[0];
      expect(line.item.name).toBeTruthy();
      expect(line.item.description).toBeTruthy();
      expect(isNum(line.invoiced_quantity)).toBe(true);
      expect(isNum(line.line_extension_amount)).toBe(true);
      expect(isNum(line.price.price_amount)).toBe(true);
      expect(line.price.price_unit.length).toBeLessThanOrEqual(3);
    });

    it("coerces string amounts and rejects a free-text price unit", () => {
      const out: any = sanitizeInvoicePayload({
        irn: "G",
        invoice_line: [
          {
            item: { name: "Software" },
            invoiced_quantity: "1",
            line_extension_amount: "150000",
            price: { price_amount: "150000", base_quantity: 1, price_unit: "NGN per 1" },
          },
        ],
      });
      const line = out.invoice_line[0];
      expect(line.line_extension_amount).toBe(150000);
      expect(line.price.price_amount).toBe(150000);
      expect(line.price.price_unit).toBe("H87");
    });
  });

  describe("tax_total", () => {
    it("coerces amounts and completes the tax category", () => {
      const out: any = sanitizeInvoicePayload({
        irn: "H",
        tax_total: [
          {
            tax_amount: "11250",
            tax_subtotal: [
              { taxable_amount: "150000", tax_amount: "11250", tax_category: { percent: "7.5" } },
            ],
          },
        ],
      });
      expect(out.tax_total[0].tax_amount).toBe(11250);
      const st = out.tax_total[0].tax_subtotal[0];
      expect(st.taxable_amount).toBe(150000);
      expect(st.tax_category.percent).toBe(7.5);
      expect(st.tax_category.id).toBeTruthy();
    });
  });

  it("is idempotent — a second pass changes nothing", () => {
    const input = {
      irn: "I",
      legal_monetary_total: { line_extension_amount: "150000" },
      invoice_line: [{ item: { name: "S" }, price: { price_amount: "1" } }],
      accounting_customer_party: { party_name: "C", tin: "" },
    };
    const once = sanitizeInvoicePayload(JSON.parse(JSON.stringify(input)));
    const twice = sanitizeInvoicePayload(JSON.parse(JSON.stringify(once)));
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });
});
