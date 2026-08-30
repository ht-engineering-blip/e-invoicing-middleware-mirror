/**
 * Sanitizes and normalizes an invoice payload before dispatching to FIRS or validation services.
 */
export function sanitizeInvoicePayload(
  rawInvoice: Record<string, unknown>,
): Record<string, unknown> {
  if (!rawInvoice || typeof rawInvoice !== "object") return rawInvoice;

  // Handle nested envelopes if passed
  let invoice: Record<string, unknown>;
  if (rawInvoice.data && typeof rawInvoice.data === "object") {
    invoice = rawInvoice.data as Record<string, unknown>;
  } else if (rawInvoice.invoice && typeof rawInvoice.invoice === "object") {
    invoice = rawInvoice.invoice as Record<string, unknown>;
  } else {
    invoice = rawInvoice;
  }

  const toFloat = (val: unknown, fallback: number = 0): number => {
    if (typeof val === "number") return isNaN(val) ? fallback : val;
    if (typeof val === "string") {
      const cleaned = val.replace(/[^0-9.-]+/g, "");
      const num = Number(cleaned);
      return isNaN(num) ? fallback : num;
    }
    return fallback;
  };

  // Sanitize business_id
  if (typeof invoice.business_id === "string") {
    invoice.business_id = invoice.business_id.trim();
  }

  // Sanitize IRN
  if (typeof invoice.irn === "string" && invoice.irn.trim() !== "") {
    invoice.irn = invoice.irn
      .toUpperCase()
      .trim()
      .replace(/\s+/g, "")
      .replace(/[^A-Z0-9-]/g, "");
  }

  if (
    !invoice.irn ||
    invoice.irn === "IRN" ||
    !/^[A-Z0-9]+-[A-Z0-9]+-[0-9]{8}$/.test(invoice.irn as string)
  ) {
    // Resolve ref using if/else
    let ref: string;
    if (
      typeof invoice.invoice_reference === "string" &&
      invoice.invoice_reference.trim() !== ""
    ) {
      ref = invoice.invoice_reference
        .trim()
        .replace(/[^A-Z0-9]/gi, "")
        .toUpperCase();
    } else {
      ref = `INV${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
    }

    // Resolve serviceId using if/else
    let serviceId: string;
    if (
      typeof invoice.business_id === "string" &&
      invoice.business_id.length >= 8
    ) {
      serviceId = invoice.business_id.slice(0, 8).toUpperCase();
    } else {
      serviceId = "8593BD6E";
    }

    // Resolve dateStr using if/else
    let dateStr: string;
    if (
      typeof invoice.issue_date === "string" &&
      invoice.issue_date.trim() !== ""
    ) {
      dateStr = invoice.issue_date.replace(/-/g, "");
    } else {
      dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    }

    invoice.irn = `${ref}-${serviceId}-${dateStr}`;
  }

  // Handle billing_reference requirement for Credit Note / Debit Note adjustment invoices
  const adjustmentCodes = ["380", "383", "384", "385", "386", "393", "395"];
  const invoiceTypeCode = String(invoice.invoice_type_code || "").trim();
  const isAdjustmentNote =
    adjustmentCodes.includes(invoiceTypeCode) ||
    (typeof invoice.invoice_kind === "string" &&
      /credit|debit/i.test(invoice.invoice_kind));

  if (isAdjustmentNote) {
    if (
      !Array.isArray(invoice.billing_reference) ||
      invoice.billing_reference.length === 0
    ) {
      const defaultRef =
        typeof invoice.irn === "string" && invoice.irn.trim() !== ""
          ? (invoice.irn as string).trim()
          : "ITW001-8593BD6E-20240514";
      const defaultDate =
        typeof invoice.issue_date === "string" &&
        invoice.issue_date.trim() !== ""
          ? (invoice.issue_date as string).trim()
          : new Date().toISOString().split("T")[0];

      invoice.billing_reference = [
        {
          irn: defaultRef,
          issue_date: defaultDate,
        },
      ];
    }
  }

  // Sanitize Reference IRNs
  if (Array.isArray(invoice.billing_reference)) {
    for (const item of invoice.billing_reference) {
      if (item && typeof item === "object") {
        const itemRecord = item as Record<string, unknown>;
        if (typeof itemRecord.irn === "string") {
          itemRecord.irn = itemRecord.irn
            .toUpperCase()
            .trim()
            .replace(/\s+/g, "")
            .replace(/[^A-Z0-9-]/g, "");
        }
        if (
          !itemRecord.issue_date ||
          typeof itemRecord.issue_date !== "string"
        ) {
          itemRecord.issue_date =
            typeof invoice.issue_date === "string" &&
            invoice.issue_date.trim() !== ""
              ? invoice.issue_date.trim()
              : new Date().toISOString().split("T")[0];
        }
      }
    }
  }

  if (Array.isArray(invoice.additional_document_reference)) {
    for (const item of invoice.additional_document_reference) {
      if (item && typeof item === "object") {
        const itemRecord = item as Record<string, unknown>;
        if (typeof itemRecord.irn === "string") {
          itemRecord.irn = itemRecord.irn
            .toUpperCase()
            .trim()
            .replace(/\s+/g, "")
            .replace(/[^A-Z0-9-]/g, "");
        }
      }
    }
  }

  const singleRefKeys = [
    "dispatch_document_reference",
    "receipt_document_reference",
    "originator_document_reference",
    "contract_document_reference",
  ];
  for (const key of singleRefKeys) {
    const docRef = invoice[key];
    if (docRef && typeof docRef === "object") {
      const refRecord = docRef as Record<string, unknown>;
      if (typeof refRecord.irn === "string") {
        refRecord.irn = refRecord.irn
          .toUpperCase()
          .trim()
          .replace(/\s+/g, "")
          .replace(/[^A-Z0-9-]/g, "");
      }
    }
  }

  if (Array.isArray(invoice.invoice_line)) {
    for (const rawLine of invoice.invoice_line) {
      if (!rawLine || typeof rawLine !== "object") continue;
      const line = rawLine as Record<string, unknown>;

      if (!line.item || typeof line.item !== "object") {
        line.item = {};
      }
      const itemObj = line.item as Record<string, unknown>;

      // Resolve itemName using if/else
      let itemName = "General Item";
      if (typeof itemObj.name === "string" && itemObj.name.trim() !== "") {
        itemName = itemObj.name.trim();
      } else if (
        typeof line.name === "string" &&
        (line.name as string).trim() !== ""
      ) {
        itemName = (line.name as string).trim();
      } else if (
        typeof line.product_category === "string" &&
        (line.product_category as string).trim() !== ""
      ) {
        itemName = (line.product_category as string).trim();
      }
      itemObj.name = itemName;

      // Resolve itemDesc using if/else
      let itemDesc = itemName;
      if (
        typeof itemObj.description === "string" &&
        itemObj.description.trim() !== ""
      ) {
        itemDesc = itemObj.description.trim();
      } else if (
        typeof line.description === "string" &&
        (line.description as string).trim() !== ""
      ) {
        itemDesc = (line.description as string).trim();
      }
      itemObj.description = itemDesc;

      // Resolve product_category using if/else
      if (
        typeof line.product_category === "string" &&
        (line.product_category as string).trim() !== ""
      ) {
        line.product_category = (line.product_category as string).trim();
      } else if (
        typeof line.service_category === "string" &&
        (line.service_category as string).trim() !== ""
      ) {
        line.product_category = (line.service_category as string).trim();
      } else if (itemName && itemName !== "General Item") {
        line.product_category = itemName;
      } else {
        line.product_category = "General Goods and Services";
      }

      if (typeof line.price === "number" || typeof line.price === "string") {
        line.price = {
          price_amount: toFloat(line.price),
          base_quantity: 1,
          price_unit: "H87",
        };
      } else if (line.price && typeof line.price === "object") {
        const priceObj = line.price as Record<string, unknown>;
        priceObj.price_amount = toFloat(priceObj.price_amount);
        priceObj.base_quantity = toFloat(priceObj.base_quantity, 1);
        const rawUnit =
          typeof priceObj.price_unit === "string"
            ? priceObj.price_unit.trim()
            : "";
        if (
          !rawUnit ||
          rawUnit.length > 3 ||
          /NGN|USD|EUR|GBP|PER|\//i.test(rawUnit) ||
          !/^[A-Z0-9]{1,3}$/i.test(rawUnit)
        ) {
          priceObj.price_unit = "H87";
        } else {
          priceObj.price_unit = rawUnit.toUpperCase();
        }
      } else {
        line.price = {
          price_amount: toFloat(line.line_extension_amount),
          base_quantity: 1,
          price_unit: "H87",
        };
      }

      const priceObj = line.price as Record<string, unknown>;
      let priceAmount: number;
      if (typeof priceObj.price_amount === "number") {
        priceAmount = priceObj.price_amount;
      } else {
        priceAmount = toFloat(priceObj.price_amount);
      }
      priceObj.price_amount = priceAmount;

      line.invoiced_quantity = toFloat(line.invoiced_quantity, 1);
      line.line_extension_amount = toFloat(
        line.line_extension_amount,
        (line.invoiced_quantity as number) * priceAmount,
      );

      if (line.discount_rate !== undefined) {
        line.discount_rate = toFloat(line.discount_rate);
      }
      if (line.discount_amount !== undefined) {
        line.discount_amount = toFloat(line.discount_amount);
      }
      if (line.fee_rate !== undefined) {
        line.fee_rate = toFloat(line.fee_rate);
      }
      if (line.fee_amount !== undefined) {
        line.fee_amount = toFloat(line.fee_amount);
      }
    }
  }

  if (
    invoice.legal_monetary_total &&
    typeof invoice.legal_monetary_total === "object"
  ) {
    const lmt = invoice.legal_monetary_total as Record<string, unknown>;
    lmt.line_extension_amount = toFloat(lmt.line_extension_amount);
    lmt.tax_exclusive_amount = toFloat(lmt.tax_exclusive_amount);
    lmt.tax_inclusive_amount = toFloat(lmt.tax_inclusive_amount);
    lmt.payable_amount = toFloat(lmt.payable_amount);
    if (lmt.prepaid_amount !== undefined) {
      lmt.prepaid_amount = toFloat(lmt.prepaid_amount);
    }
    if (lmt.allowance_total_amount !== undefined) {
      lmt.allowance_total_amount = toFloat(lmt.allowance_total_amount);
    }
    if (lmt.charge_total_amount !== undefined) {
      lmt.charge_total_amount = toFloat(lmt.charge_total_amount);
    }
  }

  if (Array.isArray(invoice.tax_total)) {
    for (const rawTt of invoice.tax_total) {
      if (!rawTt || typeof rawTt !== "object") continue;
      const tt = rawTt as Record<string, unknown>;
      tt.tax_amount = toFloat(tt.tax_amount);
      if (Array.isArray(tt.tax_subtotal)) {
        for (const rawSt of tt.tax_subtotal) {
          if (!rawSt || typeof rawSt !== "object") continue;
          const st = rawSt as Record<string, unknown>;
          st.taxable_amount = toFloat(st.taxable_amount);
          st.tax_amount = toFloat(st.tax_amount);
          if (st.tax_category && typeof st.tax_category === "object") {
            const tc = st.tax_category as Record<string, unknown>;
            tc.percent = toFloat(tc.percent);
          }
        }
      }
    }
  }

  if (Array.isArray(invoice.allowance_charge)) {
    for (const rawAc of invoice.allowance_charge) {
      if (!rawAc || typeof rawAc !== "object") continue;
      const ac = rawAc as Record<string, unknown>;
      ac.amount = toFloat(ac.amount);
    }
  }

  return invoice;
}
