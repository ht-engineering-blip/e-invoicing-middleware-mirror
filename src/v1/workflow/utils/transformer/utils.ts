import { generateRandomString } from "../../../../@lib";

export function generateDatestamp(date: Date = new Date()): string {
  date = new Date(date);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

export function sanitizeIRN(irn: string): string {
  if (typeof irn !== "string") return irn;
  return irn
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9-]/g, "");
}

export function sanitizeInvoiceIRNs(invoice: any): void {
  if (!invoice) return;

  if (invoice.irn) {
    invoice.irn = sanitizeIRN(invoice.irn);
  }

  if (Array.isArray(invoice.billing_reference)) {
    for (const ref of invoice.billing_reference) {
      if (ref && ref.irn) ref.irn = sanitizeIRN(ref.irn);
    }
  }

  if (
    invoice.dispatch_document_reference &&
    invoice.dispatch_document_reference.irn
  ) {
    invoice.dispatch_document_reference.irn = sanitizeIRN(
      invoice.dispatch_document_reference.irn,
    );
  }

  if (
    invoice.receipt_document_reference &&
    invoice.receipt_document_reference.irn
  ) {
    invoice.receipt_document_reference.irn = sanitizeIRN(
      invoice.receipt_document_reference.irn,
    );
  }

  if (
    invoice.originator_document_reference &&
    invoice.originator_document_reference.irn
  ) {
    invoice.originator_document_reference.irn = sanitizeIRN(
      invoice.originator_document_reference.irn,
    );
  }

  if (
    invoice.contract_document_reference &&
    invoice.contract_document_reference.irn
  ) {
    invoice.contract_document_reference.irn = sanitizeIRN(
      invoice.contract_document_reference.irn,
    );
  }

  if (Array.isArray(invoice.additional_document_reference)) {
    for (const ref of invoice.additional_document_reference) {
      if (ref && ref.irn) ref.irn = sanitizeIRN(ref.irn);
    }
  }
}

export function generateIRN(
  invoiceNumber: string,
  serviceId: string | undefined,
  date: Date = new Date(),
): string | undefined {
  let finalServiceId = serviceId;
  let baseRef = invoiceNumber;

  if (invoiceNumber && typeof invoiceNumber === "string") {
    // Check if the invoiceNumber is already a valid FIRS IRN pattern (e.g. PREFIX-SERVICEID-DATE)
    const match = invoiceNumber.trim().match(/^([A-Z0-9]+)-([A-Z0-9]{8})-([0-9]{8})$/i);
    if (match) {
      if (!finalServiceId) {
        finalServiceId = match[2];
      }
      baseRef = match[1];
    }
  }

  if (!finalServiceId) return undefined;

  // Validate inputs: invoiceNumber alphanumeric, serviceId 8 alphanumeric
  let padding = generateRandomString(4).substring(0, 4).toUpperCase();
  const inv = (baseRef + padding).replace(/[^A-Za-z0-9]/g, "");
  if (!/^[A-Za-z0-9]+$/.test(inv)) return undefined;
  // if (!/^[A-Za-z0-9]{8}$/.test(finalServiceId)) return undefined;
  return `${inv}-${finalServiceId}-${generateDatestamp(date)}`.toUpperCase();
}

export const FIRS_SCHEMA_EXAMPLE = `{
    "business_id": "{{TEST_BUSINESS_ID}}",
    "irn": "IRN",
    "issue_date": "2024-05-14",
    "due_date": "2024-06-14",
    "issue_time": "17:59:04",
    "invoice_type_code": "396",
    "payment_status": "PENDING",
    "note": "dummy_note (will be encryted in storage)",
    "tax_point_date": "2024-05-14",
    "document_currency_code": "NGN",
    "tax_currency_code": "NGN",
    "accounting_cost": "2000 NGN",
    "buyer_reference": "buyer REF IRN?",
    "invoice_delivery_period": {
        "start_date": "2024-06-14",
        "end_date": "2024-06-16"
    },
    "order_reference": "order REF IRN?",
    "billing_reference": [
        {
            "irn": "ITW001-E9E0C0D3-20240619",
            "issue_date": "2024-05-14"
        }
    ],
    "dispatch_document_reference": {
        "irn": "ITW001-E9E0C0D3-20240619",
        "issue_date": "2024-05-14"
    },
    "receipt_document_reference": {
        "irn": "ITW001-E9E0C0D3-20240619",
        "issue_date": "2024-05-14"
    },
    "originator_document_reference": {
        "irn": "ITW001-E9E0C0D3-20240619",
        "issue_date": "2024-05-14"
    },
    "contract_document_reference": {
        "irn": "ITW001-E9E0C0D3-20240619",
        "issue_date": "2024-05-14"
    },
    "additional_document_reference": [
        {
            "irn": "ITW001-E9E0C0D3-20240619",
            "issue_date": "2024-05-14"
        }
    ],
    "accounting_supplier_party": {
        "party_name": "Dangote Group",
        "tin": "TIN-0099990001",
        "email": "supplier_business@email.com",
        "telephone": "+23480254099000",
        "business_description": "this entity is into sales of Cement and building materials",
        "postal_address": {
            "street_name": "32, owonikoko street",
            "city_name": "Gwarikpa",
            "postal_zone": "023401",
            "country": "NG"
        }
    },
    "accounting_customer_party": {
        "party_name": "Dangote Group",
        "tin": "TIN-000001",
        "email": "business@email.com",
        "telephone": "+23480254000000",
        "business_description": "this entity is into sales of Cement and building materials",
        "postal_address": {
            "street_name": "32, owonikoko street",
            "city_name": "Gwarikpa",
            "postal_zone": "023401",
            "country": "NG"
        }
    },
    "actual_delivery_date": "2024-05-14",
    "payment_means": [
        {
            "payment_means_code": "10",
            "payment_due_date": "2024-05-14"
        }
    ],
    "payment_terms_note": "dummy payment terms note (will be encryted in storage)",
    "allowance_charge": [
        {
            "charge_indicator": true,
            "amount": 800.60
        }
    ],
    "tax_total": [
        {
            "tax_amount": 56.07,
            "tax_subtotal": [
                {
                    "taxable_amount": 800,
                    "tax_amount": 8,
                    "tax_category": {
                        "id": "LOCAL_SALES_TAX",
                        "percent": 2.3
                    }
                }
            ]
        }
    ],
    "legal_monetary_total": {
        "line_extension_amount": 340.50,
        "tax_exclusive_amount": 400,
        "tax_inclusive_amount": 430,
        "payable_amount": 30
    },
    "invoice_line": [
        {
            "hsn_code": "90983.00",
            "product_category": "Food and Beverages",
            "discount_rate": 2.01,
            "discount_amount": 0.603,
            "fee_rate": 1.01,
            "fee_amount": 50,
            "invoiced_quantity": 15,
            "line_extension_amount": 30,
            "item": {
                "name": "item name",
                "description": "item description",
                "sellers_item_identification": "identified as spoon by the seller"
            },
            "price": {
                "price_amount": 10,
                "base_quantity": 3,
                "price_unit": "NGN per 1"
            }
        }
    ],
    "invoice_reference": "INV20251007014"
}`;

export const SYSTEM_PROMPT = (
  invoice_data: any,
  today: string,
  invoiceRef: string,
  context?: string,
) => `You are an expert data transformation AI. Transform the following invoice data into the exact FIRS (Federal Inland Revenue Service) e-invoicing schema format.

CRITICAL REQUIREMENTS:

MANDATORY FIELDS (MUST BE PRESENT):
- business_id: Use "{{TEST_BUSINESS_ID}}" if not provided
- irn: Generate a unique invoice reference if not provided (format: INVYYYYMMDDXXX)
- issue_date: REQUIRED, use today (${today}) if not provided
- invoice_type_code: REQUIRED, default to "396" if not specified
- document_currency_code: REQUIRED, default to "NGN"
- accounting_supplier_party: REQUIRED with party_name, tin, email, and postal_address
- accounting_customer_party: REQUIRED with party_name, tin, email, and postal_address
- tax_total: REQUIRED - must include tax_amount and tax_subtotal array (CRITICAL FOR VALIDATION)
- legal_monetary_total: REQUIRED with line_extension_amount, tax_exclusive_amount, tax_inclusive_amount, payable_amount
- invoice_line: REQUIRED array with at least one item containing hsn_code, product_category, invoiced_quantity, line_extension_amount, item, price

TAX TOTAL REQUIREMENTS (VERY IMPORTANT):
- tax_total MUST be present as an array with at least one object
- Each tax_total object must contain:
  * tax_amount: total tax amount for this tax type
  * tax_subtotal: array of tax breakdowns
- Each tax_subtotal must contain:
  * taxable_amount: amount subject to tax
  * tax_amount: tax amount for this subtotal
  * tax_category: object with id and percent

DATE FORMATTING RULES:
1. ALL dates MUST be in YYYY-MM-DD format (e.g., "2024-05-14")
2. NEVER leave date fields empty or as empty strings
3. For missing dates in document references, use the main invoice's issue_date
4. Times must be in HH:MM:SS format

AUTO-POPULATION RULES:
1. If payment_status missing: default to "PENDING"
2. If document_currency_code missing: default to "NGN"
3. If tax_currency_code missing: default to "NGN"
4. If postal_zone missing: use "100001"
5. If telephone provided: ensure it starts with "+" (country code)
6. Generate invoice_reference if missing: "${invoiceRef}"
7. If tax_total missing: calculate from invoice lines or use zero tax

OPTIONAL FIELD HANDLING:
- due_date, issue_time, note, tax_point_date, accounting_cost, buyer_reference: Include if available
- invoice_delivery_period, order_reference: Include if available
- billing_reference, additional_document_reference: Include as arrays if available
- dispatch_document_reference, receipt_document_reference, originator_document_reference, contract_document_reference: Include as objects if available
- payment_means, allowance_charge: Include as arrays if available

PARTY INFORMATION RULES:
- accounting_supplier_party: MANDATORY (party_name, tin, email, postal_address)
- accounting_customer_party: MANDATORY (party_name, tin, email, postal_address)
- All party objects require: party_name, tin, email, postal_address
- Telephone must start with "+" if provided

VALID tax categories: {"code": 200,"data": [{"code": "STANDARD_GST","value": "Standard Goods and Services Tax","percent": "Not Available"},{"code": "REDUCED_GST","value": "Reduced Goods and Services Tax","percent": "Not Available"},{"code": "ZERO_GST","value": "Zero Goods and Services Tax","percent": "Not Available"},{"code": "STANDARD_VAT","value": "Standard Value-Added Tax","percent": "7.5"},{"code": "REDUCED_VAT","value": "Reduced Value-Added Tax","percent": "7.5"},{"code": "ZERO_VAT","value": "Zero Value-Added Tax","percent": "0.0"},{"code": "STATE_SALES_TAX","value": "State Sales Tax","percent": "Not Available"},{"code": "LOCAL_SALES_TAX","value": "Local Sales Tax","percent": "Not Available"},{"code": "ALCOHOL_EXCISE_TAX","value": "Alcohol Excise Tax","percent": "Not Available"},{"code": "TOBACCO_EXCISE_TAX","value": "Tobacco Excise Tax","percent": "Not Available"},{"code": "FUEL_EXCISE_TAX","value": "Fuel Excise Tax","percent": ""},{"code": "CORPORATE_INCOME_TAX","value": "Corporate Income Tax","percent": "Not Available"},{"code": "PERSONAL_INCOME_TAX","value": "Personal Income Tax","percent": "Not Available"},{"code": "SOCIAL_SECURITY_TAX","value": "Social Security Tax","percent": "Not Available"},{"code": "MEDICARE_TAX","value": "Medicare Tax","percent": ""},{"code": "REAL_ESTATE_TAX","value": "Real Estate Tax","percent": "Not Available"},{"code": "PERSONAL_PROPERTY_TAX","value": "Personal Property Tax","percent": "Not Available"},{"code": "CARBON_TAX","value": "Carbon Tax","percent": "Not Available"},{"code": "PLASTIC_TAX","value": "Plastic Tax","percent": "Not Available"},{"code": "IMPORT_DUTY","value": "Import Duty","percent": "Not Available"},{"code": "EXPORT_DUTY","value": "Export Duty","percent": "Not Available"},{"code": "LUXURY_TAX","value": "Luxury Tax","percent": "Not Available"},{"code": "SERVICE_TAX","value": "Service Tax","percent": "Not Available"},{"code": "TOURISM_TAX","value": "Tourism Tax","percent": "Not Available"}]}

IMPORTANT INSTRUCTIONS:
1. Return ONLY valid JSON in the exact FIRS schema format, do not include any other text or comments or special characters or html tags or any other formatting
2. Do not include any explanation, comments, or additional text
3. Map the input data intelligently to the appropriate FIRS fields
4. Use reasonable defaults for missing mandatory fields
5. Ensure all amounts and calculations are accurate and are all in valid numbers
6. For arrays, include only if data is available (don't create empty arrays)
7. TAX_TOTAL IS MANDATORY - include it even if tax is zero
8. TAX_TOTAL MUST BE PRESENT - include it even if tax is zero
9. All fields that are enum should be in the format of the example provided and must not use abitrary values
10.Do not include any other text or comments or special characters or html tags or any other formatting (\\n, \\t, \\r, \\b, \\f, \\v
11. Make sure values like email, phone number, postal codes are valid based on the FIRS schema rules so there will not be errors

FIRS SCHEMA EXAMPLE:
${FIRS_SCHEMA_EXAMPLE}

INPUT INVOICE DATA:
${JSON.stringify(invoice_data, null, 2)}

Transform the input data to match the FIRS schema exactly. Return only the JSON with no comments`;
