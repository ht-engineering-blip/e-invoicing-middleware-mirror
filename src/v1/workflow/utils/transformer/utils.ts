import { generateRandomString } from "../../../../@lib";

export function generateDatestamp(date: Date = new Date()): string {
  date = new Date(date);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

export function generateInvoiceRef(
  date: string = new Date().toISOString().slice(0, 10),
) {
  return `INV${date.replace(/-/g, "")}${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0")}`;
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

  const isAdjustmentNote = [
    "380",
    "381",
    "383",
    "384",
    "385",
    "386",
    "393",
    "395",
  ].includes(String(invoice.invoice_type_code));

  if (
    isAdjustmentNote &&
    (!Array.isArray(invoice.billing_reference) ||
      invoice.billing_reference.length === 0)
  ) {
    const defaultRef = invoice.irn;
    const defaultDate =
      invoice.issue_date || new Date().toISOString().split("T")[0];
    invoice.billing_reference = [
      { irn: sanitizeIRN(defaultRef), issue_date: defaultDate },
    ];
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

/**
 * Sanitize an HSN code to the FIRS-required format: digits + "." + exactly 2 decimal digits.
 * Handles: pure digits ("8517" → "8517.00"), missing decimals ("8517." → "8517.00"),
 * single decimal ("8517.1" → "8517.10"), extra decimals ("8517.123" → "8517.12"),
 * and non-digit characters. Returns undefined for empty/invalid input so the field
 * stays optional.
 */
export function sanitizeHsnCode(val: any): string | undefined {
  if (val === undefined || val === null) return undefined;
  let str = String(val).trim();
  if (!str) return undefined;

  // If it has letters, treat it as a custom/non-numeric HSN code and don't sanitize/format it
  if (/[a-zA-Z]/.test(str)) {
    return undefined;
  }

  // Strip any non-digit/non-dot characters
  str = str.replace(/[^\d.]/g, "");
  if (!str || str === ".") return undefined;

  // Pure digits → append .00
  if (/^\d+$/.test(str)) return `${str}.00`;
  // Trailing dot, no decimals → append 00
  if (/^\d+\.$/.test(str)) return `${str}00`;
  // One decimal digit → append 0
  if (/^\d+\.\d$/.test(str)) return `${str}0`;
  // Already valid → return as-is
  if (/^\d+\.\d{2}$/.test(str)) return str;
  // More than 2 decimal digits → truncate to 2
  const match = str.match(/^(\d+\.\d{2})/);
  if (match) return match[1];

  return "0000.00";
}

let dynamicQuantityCodes: Set<string> | null = null;
let dynamicHsCodes: Array<{
  code: string;
  label?: string;
  keywords?: string[];
}> | null = null;

export function setDynamicQuantityCodes(
  codes: Array<{ code: string; value?: string }>,
): void {
  if (Array.isArray(codes) && codes.length > 0) {
    dynamicQuantityCodes = new Set(
      codes.map((c) => c.code.toUpperCase().trim()),
    );
  }
}

export function setDynamicHsCodes(
  codes: Array<{ code: string; label?: string; keywords?: string[] }>,
): void {
  if (Array.isArray(codes) && codes.length > 0) {
    dynamicHsCodes = codes;
  }
}

/**
 * Map common free-text / currency-style price_unit values produced by LLMs
 * to their correct UN/ECE unit codes using dynamic FIRS quantity codes.
 */
export function sanitizePriceUnit(val: any): string {
  if (!val || typeof val !== "string") {
    if (dynamicQuantityCodes && dynamicQuantityCodes.size > 0) {
      return Array.from(dynamicQuantityCodes)[0];
    }
    return "H87";
  }
  const s = val.trim().toUpperCase();

  if (dynamicQuantityCodes && dynamicQuantityCodes.size > 0) {
    if (dynamicQuantityCodes.has(s)) return s;

    const base = s.replace(/\s*(PER|\/)\s*[\d\w]+.*$/, "").trim();
    if (dynamicQuantityCodes.has(base)) return base;

    return Array.from(dynamicQuantityCodes)[0];
  }

  return s;
}

/**
 * Dynamic HS code lookup using FIRS resource endpoints.
 */
const HSN_LOOKUP_TABLE: Array<{
  code: string;
  label: string;
  keywords: string[];
}> = [];

/**
 * Find the best matching real WCO/HS code for a given product or service description.
 * Searches the lookup table by keyword matching and returns the HS code in FIRS format
 * (4-digit heading + ".00"), e.g., "8471.00" for computers.
 *
 * @param description - The product category, service category or item description to look up
 * @returns A valid HS code string in FIRS format, or a safe default if no match found
 */
export function lookupHsnCode(description: string): string {
  if (!description || typeof description !== "string") return "9999.00";

  const normalized = description.toLowerCase().trim();

  if (dynamicHsCodes && dynamicHsCodes.length > 0) {
    let bestMatch: { code: string; score: number } | undefined;

    for (const entry of dynamicHsCodes) {
      if (!entry) continue;
      let score = 0;
      const targetText =
        (entry.label || "") +
        " " +
        (entry.keywords ? entry.keywords.join(" ") : "");
      const targetLower = targetText.toLowerCase();

      const words = normalized.split(/\s+/).filter((w) => w.length > 2);
      for (const word of words) {
        if (targetLower.includes(word)) {
          score += word.length;
        }
      }

      if (score > 0 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { code: entry.code, score };
      }
    }

    if (bestMatch) {
      const codeStr = bestMatch.code.includes(".")
        ? bestMatch.code
        : `${bestMatch.code}.00`;
      return sanitizeHsnCode(codeStr) || "9999.00";
    }
  }

  return "9999.00";
}

/**
 * Generates a valid WCO HS code for a missing hsn_code on an invoice line
 * dynamically using FIRS HS codes.
 *
 * @param existingCodes - Set of codes already used on this invoice (to avoid duplicates)
 * @param lineDescription - Optional product_category or item description for smart lookup
 * @returns A real HS code string in FIRS format (e.g. "8471.00")
 */
export function generateUniqueHsnCode(
  existingCodes: Set<string>,
  lineDescription?: string,
): string {
  if (lineDescription) {
    const looked = lookupHsnCode(lineDescription);
    if (looked && !existingCodes.has(looked)) {
      existingCodes.add(looked);
      return looked;
    }
  }

  if (dynamicHsCodes && dynamicHsCodes.length > 0) {
    for (const entry of dynamicHsCodes) {
      if (!entry?.code) continue;
      const codeStr = entry.code.includes(".")
        ? entry.code
        : `${entry.code}.00`;
      const sanitized = sanitizeHsnCode(codeStr);
      if (sanitized && !existingCodes.has(sanitized)) {
        existingCodes.add(sanitized);
        return sanitized;
      }
    }
  }

  const fallback = Array.from(existingCodes)[0] || "8471.00";
  return fallback;
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
    const match = invoiceNumber
      .trim()
      .match(/^([A-Z0-9]+)-([A-Z0-9]{8})-([0-9]{8})$/i);
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
    "business_id": "8f8b8e88-6b83-4a34-934d-1a8684bb57f2",
    "irn": "IRN",
    "issue_date": "2024-05-14",
    "due_date": "2024-06-14",
    "issue_time": "17:59:04",
    "invoice_type_code": "396",
    "invoice_kind": "B2B",
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
        "party_name": "Heirs Technologies",
        "tin": "TIN-0099990001",
        "email": "supplier_business@email.com",
        "telephone": "+23480254099000",
        "business_description": "this entity is into sales of Cement and building materials",
        "postal_address": {
            "street_name": "32, owonikoko street",
            "city_name": "Gwarikpa",
            "postal_zone": "023401",
            "lga": "NG-AB-ANO",
            "state": "NG-AB",
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
            "lga": "NG-AB-ANO",
            "state": "NG-AB",
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
                        "id": "STANDARD_VAT",
                        "percent": 7.5
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
            "hsn_code": "1006.30",
            "product_category": "Cereals; rice, semi-milled or wholly milled",
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
                "price_unit": "XBG"
            }
        },
        {
            "isic_code": "0112",
            "service_category": "Growing of rice",
            "discount_rate": 2.01,
            "discount_amount": 0.603,
            "fee_rate": 1.01,
            "fee_amount": 50,
            "invoiced_quantity": 15,
            "line_extension_amount": 30,
            "item": {
                "name": "item name 2",
                "description": "item description 2",
                "sellers_item_identification": "identified as shovel by the seller"
            },
            "price": {
                "price_amount": 20,
                "base_quantity": 5,
                "price_unit": "XBG"
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
- invoice_kind: REQUIRED, default to "B2B" if not specified
- document_currency_code: REQUIRED, default to "NGN"
- accounting_supplier_party: REQUIRED with party_name, tin, email, and postal_address
- accounting_customer_party: REQUIRED with party_name, tin, email, and postal_address
- tax_total: REQUIRED - must include tax_amount and tax_subtotal array (CRITICAL FOR VALIDATION)
- legal_monetary_total: REQUIRED with line_extension_amount, tax_exclusive_amount, tax_inclusive_amount, payable_amount
- invoice_line: REQUIRED array with at least one item containing invoiced_quantity, line_extension_amount, item (name, description), price; PLUS either hsn_code (goods) or isic_code (services)


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
- payee_party, bill_party, ship_party, tax_representative_party: Include as party objects if available in the input
- postal_address.lga, postal_address.state: Include if available in the input

PRICE UNIT RULES (CRITICAL):
- price_unit MUST be a UN/ECE Recommendation 20 unit-of-measure code. It is NOT a currency code.
- NEVER use "NGN", "USD", "NGN per 1", "NGN/1", or any currency as price_unit.
- Common valid price_unit codes:
  * H87  = Piece (default for most goods — use when unsure)
  * XBG  = Bag (e.g., 50kg bag of rice)
  * XBX  = Box
  * XCT  = Carton
  * KGM  = Kilogram
  * TNE  = Tonne (metric ton)
  * LTR  = Litre
  * MTR  = Metre
  * SET  = Set
  * DZN  = Dozen
- If the unit from the input is a currency or unrecognised, default to "H87" (piece).

- hsn_code: Used ONLY for goods/products. Must be a real WCO Harmonized System (HS) 4-digit heading code followed by ".00". Format: "XXXX.00" where XXXX is a valid HS heading.
- isic_code: Used ONLY for services. Must be a real ISIC (International Standard Industrial Classification) code.
- A line item for GOODS must have hsn_code (e.g., "8471.00" for computers, "1006.00" for rice, "8703.00" for vehicles)
- A line item for SERVICES must have isic_code (e.g., "6201" for financial services, "6920" for accounting, "7010" for real estate)
- DO NOT use both hsn_code and isic_code on the same invoice line
- DO NOT generate random 4-digit numbers for hsn_code
- Common real HS codes by category:
  * Food & Agriculture: rice=1006, wheat=1001, maize/corn=1005, sugar=1701, palm oil=1511, fish=0302, chicken=0207
  * Building/Construction: cement=2523, steel bar=7213, iron pipe=7304, ceramic tile=6907, paint=3210
  * Electronics: computer=8471, smartphone=8517, tv=8528, generator=8502, transformer=8504, cable=8544, solar panel=8541
  * Vehicles: car=8703, truck=8704, motorcycle=8711, bus=8702, tractor=8701
  * Chemicals/Pharma: medicine=3004, vaccine=3002, fertilizer=3102, pesticide=3808, soap=3401
  * Textiles/Apparel: fabric=5208, shirt=6205, trouser=6203, shoe=6403, hat=6505
  * Machinery: pump=8413, compressor=8414, weighing scale=8423, printing machine=8443, sewing machine=8452
  * Petroleum: crude oil=2709, diesel/petrol=2710, lpg=2711
  * General merchandise/unknown goods: use 9403 (furniture) or 9503 (toys/misc)

INVOICE LINE CLASSIFICATION RULES:
- If the line item is a physical product: set hsn_code to the appropriate HS heading (e.g., "8471.00" for a laptop)
- If the line item is a service: set isic_code to the appropriate ISIC code; do NOT set hsn_code
- item.name is REQUIRED - use the product name or service name from the input data
- item.description is REQUIRED - provide a brief description

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
9. All fields that are enum should be in the format of the example provided and must not use arbitrary values
10. Do not include any other text or comments or special characters or html tags or any other formatting (\\n, \\t, \\r, \\b, \\f, \\v)
11. Make sure values like email, phone number, postal codes are valid based on the FIRS schema rules so there will not be errors
12. HSN codes MUST be real WCO/HS heading codes. Do NOT use random numbers. Determine the correct HS chapter from the product type.
13. item.name is REQUIRED in every invoice_line item object - use the product or service name

FIRS SCHEMA EXAMPLE:
${FIRS_SCHEMA_EXAMPLE}

INPUT INVOICE DATA:
${JSON.stringify(invoice_data, null, 2)}

Transform the input data to match the FIRS schema exactly. Return only the JSON with no comments`;
