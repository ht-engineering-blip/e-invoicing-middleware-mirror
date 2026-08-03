import { z } from "zod";
import { AuthContext } from "../../../../middlewares";
import { ISchemaField, SchemaSourceType } from "../../models";
import { TransformWorkflowService } from "../../services";
import { FIRSInvoiceSchema, TransformationResult } from ".";
import { InternalServerError, logger } from "../../../../@lib";
import {
  generateDatestamp,
  generateIRN,
  sanitizeInvoiceIRNs,
  sanitizeHsnCode,
  sanitizePriceUnit,
  sanitizeLineItemDescriptions,
  setDynamicQuantityCodes,
  setDynamicHsCodes,
} from "./utils";

import { FIRS_INVOICE_METADATA } from "../defaults";
import {
  formatSchemaFields,
  generateTransformPrompt,
  getOptionalFields,
  getRequiredFields,
} from "../../../../@lib/adapters/llm/prompts";
import { FIRSService } from "../../../../@lib/adapters/firs/firs.service";
import {
  TaxCategory,
  InvoiceType,
  QuantityCode,
  HsCode,
} from "../../../../@lib/adapters/firs/types";
import { SAMPLE_INVOICE_BODY } from "../../../invoicing/examples/invoices.examples";

/* -----------------------------------------------------
 CLASS
----------------------------------------------------- */

export class FIRSInvoiceTransformerV2 {
  private apiKey: string;
  private apiEndpoint: string;

  constructor(
    apiKey: string,
    apiEndpoint: string = "https://api.openai.com/v1/chat/completions",
  ) {
    this.apiKey = apiKey;
    this.apiEndpoint = apiEndpoint;
  }

  /**
   * Transformation and validation method
   * @param invoiceData - The raw invoice data to transform
   * @param authContext - Authentication context with tenant/business info
   * @param sourceType - The source ERP type (e.g., SAP, ORACLE, ZOHO) for schema-based transformation
   */
  async transformAndValidate(
    invoice: any,
    authContext?: AuthContext,
    sourceType?: SchemaSourceType | string,
  ): Promise<TransformationResult | undefined> {
    const transformService = new TransformWorkflowService();

    let sourceSchema: ISchemaField[] = [];
    let mappingRules: Array<Record<string, any>> = [];
    let firsSchema: ISchemaField[] = [];

    try {
      // Fetch source ERP schema if source type is provided
      if (sourceType) {
        const sourceSchemaDoc =
          await transformService.getInvoiceSchema(sourceType);
        if (sourceSchemaDoc) {
          sourceSchema = sourceSchemaDoc.fields;
          mappingRules = sourceSchemaDoc.mapping_rules || [];
        }
      }

      // Fetch FIRS UBL schema
      const firsSchemaDoc = await transformService.getInvoiceSchema(
        SchemaSourceType.FIRS_UBL,
      );
      if (firsSchemaDoc) {
        firsSchema = firsSchemaDoc.fields;
      }
      // Transform using LLM with schema-based prompts
      let result: any = await this.transformInvoice(
        invoice,
        authContext!,
        sourceSchema,
        firsSchema,
        mappingRules,
        FIRSInvoiceSchema,
      );

      console.log("Transforming invoice data...");

      if (!result.success) {
        console.error(result.error);
        return {
          success: false,
          errors: Array.isArray(result.error)
            ? result.error
            : [String(result.error)],
        };
      }

      const transformedData = result.data;
      sanitizeInvoiceIRNs(transformedData);
      return {
        success: true,
        data: transformedData,
      };
    } catch (error) {
      throw new InternalServerError(
        `Transformation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /* -----------------------------------------------------
     PUBLIC TRANSFORM METHOD
    ----------------------------------------------------- */

  async transformInvoice(
    invoice: any,
    authContext: AuthContext,
    sourceSchema: ISchemaField[],
    firsSchema: ISchemaField[],
    mappingRules: any[],
    firsZodSchema: z.ZodSchema,
  ) {
    try {
      const firsService = new FIRSService();
      let taxCategories: TaxCategory[] = [];
      let invoiceTypes: InvoiceType[] = [];
      try {
        const [taxCatRes, invoiceTypeRes, qtyCodesRes, hsCodesRes] =
          await Promise.all([
            firsService.getResource<TaxCategory>("tax-categories"),
            firsService.getResource<InvoiceType>("invoice-types"),
            firsService.getResource<QuantityCode>("invoice-quantity-codes"),
            firsService.getResource<HsCode>("hs-codes"),
          ]);
        taxCategories = taxCatRes || [];
        invoiceTypes = invoiceTypeRes || [];
        if (qtyCodesRes) setDynamicQuantityCodes(qtyCodesRes);
        if (hsCodesRes) setDynamicHsCodes(hsCodesRes);
      } catch (e) {
        console.error("Failed to fetch FIRS resources:", e);
      }

      const schemaGraph = this.buildSchemaGraph(firsSchema);
      //logger.info("Schema Graph", schemaGraph)

      const mapped = this.deterministicTransform(invoice, mappingRules);
      //logger.info("Mapped", mapped)
      const base = { ...invoice, ...mapped };
      // logger.info("base", base)
      const resolved = this.ensureRequiredFields(base, firsSchema);
      // logger.info("resolved", resolved)

      // Set expected identity fields securely
      const expectedBusinessId = authContext?.businessId;
      const expectedSupplierTIN = authContext?.businessTIN;
      const todayStr = new Date().toISOString().slice(0, 10);
      const invoiceRef =
        invoice.invoice_reference ||
        `INV${todayStr.replace(/-/g, "")}${Math.floor(Math.random() * 1000)
          .toString()
          .padStart(3, "0")}`;
      const computedIrn = generateIRN(
        invoiceRef,
        authContext?.serviceId,
        invoice.date || invoice.issue_date || invoice.issueDate
          ? new Date(invoice.date || invoice.issue_date || invoice.issueDate)
          : undefined,
      );
      const expectedIrn = invoice.irn || computedIrn;

      if (expectedBusinessId) {
        resolved.business_id = expectedBusinessId;
      }
      if (expectedIrn) {
        resolved.irn = expectedIrn;
      }
      if (expectedSupplierTIN) {
        if (!resolved.accounting_supplier_party) {
          resolved.accounting_supplier_party = {};
        }
        resolved.accounting_supplier_party.tin = expectedSupplierTIN;
      }

      const missing = this.findMissingFields(resolved, firsSchema);
      //  logger.info("missing", missing)
      let completed = resolved;
      //  logger.info("completed", completed)
      if (missing.length > 0) {
        const prompt = this.buildSchemaAwarePrompt(
          resolved,
          authContext,
          sourceSchema,
          firsSchema,
          missing,
          taxCategories,
          invoiceTypes,
        );
        //logger.info("prompt", prompt)
        const response = await this.callLLM(prompt);
        //  logger.info("response", response)
        const parsed = this.safeParseLLMJSON(response);
        //  logger.info("parsed", parsed)

        // Warn if LLM modified identity fields — force-overwrite below will correct them
        if (
          parsed.business_id !== undefined &&
          expectedBusinessId &&
          parsed.business_id !== expectedBusinessId
        ) {
          console.warn(
            `[TransformerV2] LLM changed business_id from "${expectedBusinessId}" to "${parsed.business_id}" — will be overwritten`,
          );
        }
        if (
          parsed.irn !== undefined &&
          expectedIrn &&
          parsed.irn !== expectedIrn
        ) {
          console.warn(
            `[TransformerV2] LLM changed irn from "${expectedIrn}" to "${parsed.irn}" — will be overwritten`,
          );
        }
        const parsedSupplierTIN = parsed.accounting_supplier_party?.tin;
        if (
          parsedSupplierTIN !== undefined &&
          expectedSupplierTIN &&
          parsedSupplierTIN !== expectedSupplierTIN
        ) {
          console.warn(
            `[TransformerV2] LLM changed supplier TIN from "${expectedSupplierTIN}" to "${parsedSupplierTIN}" — will be overwritten`,
          );
        }

        completed = { ...resolved, ...parsed };

        // Force-overwrite identity fields post-merge to prevent bypass
        if (expectedBusinessId) {
          completed.business_id = expectedBusinessId;
        }
        if (expectedIrn) {
          completed.irn = expectedIrn;
        }
        if (expectedSupplierTIN) {
          if (!completed.accounting_supplier_party) {
            completed.accounting_supplier_party = {};
          }
          completed.accounting_supplier_party.tin = expectedSupplierTIN;
        }

        logger.info("completed", completed);
      }

      // Deterministic HSN code, price_unit, and item description sanitization
      sanitizeLineItemDescriptions(completed);
      if (Array.isArray(completed.invoice_line)) {
        for (const line of completed.invoice_line) {
          if (line.hsn_code !== undefined && line.hsn_code !== null) {
            const sanitized = sanitizeHsnCode(line.hsn_code);
            if (sanitized !== undefined) {
              line.hsn_code = sanitized;
            }
          }
          if (line.price && line.price.price_unit !== undefined) {
            line.price.price_unit = sanitizePriceUnit(line.price.price_unit);
          }
        }
      }

      const validation = this.validateWithZod(completed, firsZodSchema);
      logger.info("validation", validation);

      if (!validation.valid) {
        completed = await this.repairJSON(
          completed,
          validation.errors,
          authContext,
          sourceSchema,
          taxCategories,
          invoiceTypes,
        );
        // Deterministic HSN code, price_unit, and item description sanitization post-repair
        sanitizeLineItemDescriptions(completed);
        if (Array.isArray(completed.invoice_line)) {
          for (const line of completed.invoice_line) {
            if (line.hsn_code !== undefined && line.hsn_code !== null) {
              const sanitized = sanitizeHsnCode(line.hsn_code);
              if (sanitized !== undefined) {
                line.hsn_code = sanitized;
              }
            }
            if (line.price && line.price.price_unit !== undefined) {
              line.price.price_unit = sanitizePriceUnit(line.price.price_unit);
            }
          }
        }
      }

      logger.info("final", completed);

      return {
        success: true,
        data: completed,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message,
        originalInvoice: invoice,
      };
    }
  }

  /* -----------------------------------------------------
     SCHEMA GRAPH
    ----------------------------------------------------- */

  private buildSchemaGraph(schema: ISchemaField[]) {
    const graph: Record<string, string[]> = {};

    for (const field of schema) {
      if (!field.parent_field_id) continue;

      if (!graph[field.parent_field_id]) {
        graph[field.parent_field_id] = [];
      }

      graph[field.parent_field_id].push(field.field_path);
    }

    return graph;
  }

  /* -----------------------------------------------------
     OBJECT UTILITIES
    ----------------------------------------------------- */

  /**
   * Flatten a nested object (including arrays) into dot-notation keys.
   * Arrays are keyed by numeric index: "items.0.description", "items.1.description"
   * This ensures deterministicTransform can always locate any value in the source.
   */
  private flattenObject(
    obj: any,
    prefix = "",
    res: Record<string, any> = {},
  ): Record<string, any> {
    if (obj == null || typeof obj !== "object") {
      if (prefix) res[prefix] = obj;
      return res;
    }

    const entries: [string, any][] = Array.isArray(obj)
      ? obj.map((v, i) => [String(i), v])
      : Object.entries(obj);

    for (const [key, val] of entries) {
      const prop = prefix ? `${prefix}.${key}` : key;
      if (val !== null && typeof val === "object") {
        this.flattenObject(val, prop, res);
      } else {
        res[prop] = val;
      }
    }

    return res;
  }

  /**
   * Set a value anywhere in a nested object/array using a dot-notation path.
   * Bracket notation is normalised: "items[0].name" → "items.0.name"
   * Numeric segments auto-create arrays; string segments auto-create objects.
   * "[*]" sets the value on every element of the target array.
   */
  private setDeepValue(obj: any, path: string, value: any): void {
    // Normalise bracket notation to dot-notation
    const keys = path
      .replace(/\[(\d+|\*)\]/g, ".$1")
      .split(".")
      .filter(Boolean);

    let current = obj;

    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      const nextKey = keys[i + 1];

      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        throw new Error("Prototype pollution attempt detected");
      }

      if (current[key] == null || typeof current[key] !== "object") {
        // Create array if next key is numeric, otherwise create object
        current[key] = /^\d+$/.test(nextKey) ? [] : {};
      }

      // nosemgrep: javascript.lang.security.audit.prototype-pollution.prototype-pollution-loop.prototype-pollution-loop
      current = current[key];
    }

    const last = keys[keys.length - 1];

    if (
      last === "__proto__" ||
      last === "constructor" ||
      last === "prototype"
    ) {
      throw new Error("Prototype pollution attempt detected");
    }

    if (last === "*") {
      // Wildcard: apply value to every element of the current array
      if (Array.isArray(current)) {
        current.forEach((_: any, i: number) => {
          current[i] = value;
        });
      }
    } else {
      current[last] = value;
    }
  }

  /**
   * Get a value from anywhere in a nested object/array using a dot-notation path.
   * Bracket notation is normalised: "items[0].name" → "items.0.name"
   * "[*]" collects the value from every element of the array at that position.
   */
  private getDeepValue(obj: any, path: string): any {
    const keys = path
      .replace(/\[(\d+|\*)\]/g, ".$1")
      .split(".")
      .filter(Boolean);
    return this._traverseDeep(obj, keys);
  }

  private _traverseDeep(current: any, keys: string[]): any {
    if (keys.length === 0) return current;
    if (current == null) return undefined;

    const [head, ...rest] = keys;

    if (
      head === "__proto__" ||
      head === "constructor" ||
      head === "prototype"
    ) {
      throw new Error("Prototype pollution attempt detected");
    }

    if (head === "*") {
      if (!Array.isArray(current)) return undefined;
      const results = current
        .map((item: any) => this._traverseDeep(item, rest))
        .filter((v: any) => v !== undefined);
      if (results.length === 0) return undefined;
      return results.length === 1 ? results[0] : results;
    }

    return this._traverseDeep(current[head], rest);
  }

  /* -----------------------------------------------------
     RULE MAPPING ENGINE
    ----------------------------------------------------- */

  private deterministicTransform(invoice: any, mappingRules: any[]) {
    // Flatten the entire invoice (arrays included) so every leaf value
    // is reachable by its dot-notation path e.g. "items.0.description"
    const flat = this.flattenObject(invoice);

    const result: Record<string, any> = {};

    for (const rule of mappingRules || []) {
      if (!rule.source || !rule.target) continue;

      // Normalise the source path to dot-notation for flat-map lookup
      const normalised = rule.source.replace(/\[(\d+|\*)\]/g, ".$1");

      // 1. Exact match in the flat map (fastest, handles simple paths)
      let value: any = flat[normalised] ?? flat[rule.source];

      // 2. Fallback: traverse the original invoice (handles [*] wildcards
      //    and any path format the flat key normalisation may have missed)
      if (value === undefined) {
        value = this.getDeepValue(invoice, rule.source);
      }

      // 3. If a wildcard returned an array but the target is a scalar,
      //    take the first element
      if (
        Array.isArray(value) &&
        !rule.target.includes("[*]") &&
        !rule.target.includes(".*")
      ) {
        value = value[0];
      }

      if (value !== undefined) {
        this.setDeepValue(result, rule.target, value);
      }
    }

    return result;
  }

  /* -----------------------------------------------------
     REQUIRED FIELD RESOLUTION
    ----------------------------------------------------- */

  private ensureRequiredFields(data: any, schema: ISchemaField[]) {
    for (const field of schema) {
      console.log({ field });
      let fieldRequired =
        field.is_required || field.validation_rules!.indexOf("required") > -1;

      if (!fieldRequired) continue;

      const existing = this.getDeepValue(data, field.field_path);

      if (existing === undefined && field.default_value !== undefined) {
        this.setDeepValue(data, field.field_path, field.default_value);
      }
    }

    return data;
  }

  /* -----------------------------------------------------
     MISSING FIELD DETECTION
    ----------------------------------------------------- */

  private isValMissing(val: any): boolean {
    if (val === undefined || val === null || val === "") return true;
    if (Array.isArray(val)) {
      return val.length === 0 || val.some((v) => this.isValMissing(v));
    }
    return false;
  }

  private findMissingFields(data: any, schema: ISchemaField[]) {
    const missing: string[] = [];

    for (const field of schema) {
      let fieldRequired =
        field.is_required || field.validation_rules!.indexOf("required") > -1;

      if (!fieldRequired) continue;

      const value = this.getDeepValue(data, field.field_path);

      if (this.isValMissing(value)) {
        missing.push(field.field_path);
      }
    }

    return missing;
  }

  /* -----------------------------------------------------
     SCHEMA AWARE PROMPT BUILDER
    ----------------------------------------------------- */

  private buildSchemaAwarePrompt(
    invoice: any,
    authContext: AuthContext,
    sourceSchema: ISchemaField[],
    firsSchema: ISchemaField[],
    missingFields: string[],
    taxCategories: TaxCategory[],
    invoiceTypes: InvoiceType[],
  ) {
    const requiredFields = firsSchema
      .filter(
        (f) => f.is_required || f.validation_rules!.indexOf("required") > -1,
      )
      .map((f) => ({
        path: f.field_path,
        type: f.data_type,
        enum: f.enum_values,
        example: f.example_value,
        description: f.description,
      }));

    const today = new Date().toISOString().slice(0, 10);
    const invoiceRef = `INV${new Date().toISOString().slice(0, 10).replace(/-/g, "")}${Math.floor(
      Math.random() * 1000,
    )
      .toString()
      .padStart(3, "0")}`;
    let irn = generateIRN(
      invoiceRef,
      authContext?.serviceId,
      invoice.issueDate ? new Date(invoice.issueDate) : undefined,
    );

    // Build source schema section
    let sourceSchemaSection = "";
    if (sourceSchema && sourceSchema.length > 0) {
      const sourceRequired = getRequiredFields(sourceSchema);
      const sourceOptional = getOptionalFields(sourceSchema);
      sourceSchemaSection = `
## SOURCE ERP SCHEMA FIELDS:
${formatSchemaFields(sourceSchema, "Source ERP")}

Source Required Fields: ${sourceRequired.join(", ") || "None specified"}
Source Optional Fields: ${sourceOptional.join(", ") || "None specified"}
`;
    }

    // Build FIRS schema section
    let firsSchemaSection = "";
    if (firsSchema && firsSchema.length > 0) {
      const firsRequired = getRequiredFields(firsSchema);
      const firsOptional = getOptionalFields(firsSchema);
      firsSchemaSection = `
## TARGET FIRS UBL SCHEMA FIELDS:
${formatSchemaFields(firsSchema, "FIRS UBL")}

FIRS Required Fields: ${firsRequired.join(", ") || "None specified"}
FIRS Optional Fields: ${firsOptional.join(", ") || "None specified"}
`;
    }
    let businessContext = `
            ## BUSINESS CONTEXT:
            - Business ID: ${authContext.businessId || "{{TEST_BUSINESS_ID}}"}
            - Tenant ID: ${authContext.tenantId || "N/A"}
            - Tenant Business Name: ${authContext.businessName}
            - Tenant Business TIN: ${authContext.businessTIN}
            - Service ID: ${authContext?.serviceId}
            - Default IRN: ${invoice.irn ?? irn}
            `;
    return `
You are an expert data transformation AI specializing in Nigerian FIRS (Federal Inland Revenue Service) e-invoicing compliance. Transform the provided invoice data into the exact FIRS UBL schema format.

${businessContext}
${sourceSchemaSection}
${firsSchemaSection}

--------------------------------

MISSING FIELDS
${JSON.stringify(missingFields)}

--------------------------------
# FIRS INVOICE TRANSFORMATION RULES

## MANDATORY FIELDS (MUST BE PRESENT) do not change the field names:
- business_id: Use "${authContext?.businessId || "{{TEST_BUSINESS_ID}}"}"
- irn: Generate unique reference if not provided, use ${invoice.irn ?? irn} as default
- irn should follow the format {invoiceReference}-{ServiceID}-${generateDatestamp(invoice?.date || invoice?.issue_date || new Date())}
- issue_date: REQUIRED, use today (${today}) if not provided
- invoice_type_code: REQUIRED, derive from invoice payload and map to the right VALID INVOICE TYPES (e.g., "396" for standard Commercial Invoice, "381" for Credit Note, "384" for Debit Note), default to "396" if not specified. NOTE: Credit Note ("381", "393", "395") and Debit Note ("383", "384") represent adjustment documents and REQUIRE "billing_reference".
- billing_reference: REQUIRED for Credit Notes ("381", "393", "395") and Debit Notes ("383", "384"). Must contain an array of objects linking the credit/debit note to the original invoice(s), each object must have "irn" and "issue_date". Optional for other invoice types. Do not include empty array if not a Credit/Debit Note.
- document_currency_code: REQUIRED, default to "NGN"
- accounting_supplier_party: REQUIRED with party_name, tin, email, and postal_address, for outbound you should use business context if supplier information is not provided
- accounting_customer_party: REQUIRED with party_name, tin, email, and postal_address
- tax_total: REQUIRED - must include tax_amount and tax_subtotal array
- legal_monetary_total: REQUIRED with line_extension_amount, tax_exclusive_amount, tax_inclusive_amount, payable_amount
- invoice_line: REQUIRED array with at least one item

Ensure all keys above are not changed

## TAX TOTAL REQUIREMENTS (CRITICAL):
- tax_total MUST be present as an array with at least one object
- Each tax_total object must contain:
  * tax_amount: total tax amount for this tax type
  * tax_subtotal: array of tax breakdowns with taxable_amount, tax_amount, tax_category (id, percent)

## VALID TAX CATEGORIES:
${JSON.stringify(taxCategories, null, 2)}

## VALID INVOICE TYPES:
${JSON.stringify(invoiceTypes, null, 2)}

## DATE/TIME FORMATTING RULES:
1. ALL dates MUST be in YYYY-MM-DD format (e.g., "2024-05-14")
2. NEVER leave date fields empty or as empty strings
3. For missing dates in document references, use the main invoice's issue_date
4. Times must be in HH:MM:SS format

## AUTO-POPULATION RULES:
1. payment_status: default to "PENDING" if missing
2. document_currency_code: default to "NGN" if missing
3. tax_currency_code: default to "NGN" if missing
4. postal_zone: use "100001" if missing
5. telephone: ensure it starts with "+" (country code)
6. invoice_kind: default to "B2B" if missing

## PARTY INFORMATION RULES:
- accounting_supplier_party: MANDATORY (party_name, tin, email, postal_address)
- accounting_customer_party: MANDATORY (party_name, tin, email, postal_address)
- All party objects require: party_name, tin, email, postal_address
- Telephone must start with "+" if provided
- TIN format should be preserved from source

## FIELD METADATA REQUIREMENTS:
${JSON.stringify(FIRS_INVOICE_METADATA.category_summary, null, 2)}
--------------------------------

## INVOICE LINE ITEM RULES:
Each invoice_line must contain:
- hsn_code: product/service classification code. MUST NOT be empty. If it is missing or empty in the input data, you must deduce the correct HSN code from the item name or description (e.g., if the item is "phone", deduce the HSN code for mobile phones). If it does not contain a decimal point, format it to end with ".00" (e.g., "90983" becomes "90983.00"). Ensure each distinct type of product or service in the invoice line items has a unique and appropriate HSN code assigned (do not reuse the same HSN code for different products or services).
- product_category: category name
- invoiced_quantity: quantity (number)
- line_extension_amount: line total before tax
- item: object with name, description
- price: object with price_amount (number), base_quantity (number, usually 1), price_unit (UN/ECE unit code — NOT a currency; use H87=piece, XBG=bag, KGM=kg, LTR=litre, TNE=tonne, XBX=box, XCT=carton; default H87 if unsure — NEVER use "NGN", "USD" or similar currency codes)

## IMPORTANT INSTRUCTIONS:
1. Return ONLY valid JSON in the exact FIRS schema format
2. Do not include any explanation, comments, or additional text
3. Map the input data intelligently to the appropriate FIRS fields
4. Use reasonable defaults for missing mandatory fields
5. Ensure all amounts and calculations are accurate numbers
6. For arrays, include only if data is available
7. TAX_TOTAL IS MANDATORY - include it even if tax is zero
8. All enum fields should use valid FIRS codes only
9. Do not include escape sequences (\\n, \\t, \\r, etc.)
10. Ensure email, phone, postal codes are valid per FIRS rules
11. Focus on mandatory fields by FIRS, only populate optional fields if provided.
12. invoice_unique_number should be "irn" in the final result
13. For any field representing a state or LGA (Local Government Area), return the corresponding FIRS code (e.g., "NG-LA", "NG-LA-IKJ") and NOT the full name.
14. Map ERP standard invoice_type_code 380 (Commercial Invoice) to FIRS code 396 (Invoice Request) unless it is explicitly a Credit Note.
15. Extract nexted keys in payload to match the valid FIRS schema
16. optional fields should not be included if not provided by invoice input! [allowance_charge]
17. Descriptions and should have default values derived from product
 
FIRS SCHEMA EXAMPLE (Use this only as an example for a valid invoice payload):
${SAMPLE_INVOICE_BODY}

## INPUT INVOICE DATA TO TRANSFORM:
${JSON.stringify(invoice, null, 2)}
 
Transform the input data to match the FIRS UBL schema exactly. Return only valid JSON.

Complete the missing fields also generate emails here missing currency should default to NGN when missing.
`;
  }

  /* -----------------------------------------------------
     LLM CALL
    ----------------------------------------------------- */

  private async callLLM(prompt: string) {
    const response = await fetch(this.apiEndpoint, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },

      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 4000,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "You are a strict JSON generator.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    });

    const json = await response.json();

    return json.choices[0].message.content;
  }

  /* -----------------------------------------------------
     JSON PARSER
    ----------------------------------------------------- */

  private safeParseLLMJSON(text: string) {
    const cleaned = text
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    return JSON.parse(cleaned);
  }

  /* -----------------------------------------------------
     ZOD VALIDATION
    ----------------------------------------------------- */

  private validateWithZod(data: any, schema: z.ZodSchema) {
    const result = schema.safeParse(data);

    if (result.success) {
      return {
        valid: true,
        data: result.data,
      };
    }

    return {
      valid: false,
      errors: result.error.flatten(),
    };
  }

  /* -----------------------------------------------------
     REPAIR ENGINE
    ----------------------------------------------------- */

  private async repairJSON(
    json: any,
    errors: any,
    authContext: AuthContext,
    sourceSchema: ISchemaField[],
    taxCategories: TaxCategory[],
    invoiceTypes: InvoiceType[],
  ) {
    const expectedBusinessId = authContext?.businessId || json.business_id;
    const expectedSupplierTIN =
      authContext?.businessTIN || json.accounting_supplier_party?.tin;
    const expectedIrn = json.irn;

    const metaContext: string = `
                Initial Validation Errors:
                ${JSON.stringify(errors)} 

`;

    const systemPrompt = await generateTransformPrompt(
      json,
      authContext,
      undefined,
      sourceSchema,
      metaContext,
    );

    const prompt = `
                The JSON below failed validation.

                Errors:
                ${JSON.stringify(errors)}

                Fix the JSON.

                JSON:
                ${JSON.stringify(json)}


## MANDATORY FIELDS (MUST BE PRESENT) do not change the field names:
- business_id: Use "${authContext?.businessId || "{{TEST_BUSINESS_ID}}"}" 
- invoice_type_code: REQUIRED, derive from invoice payload and map to the right VALID INVOICE TYPES (e.g., "396" for standard Commercial Invoice, "381" for Credit Note, "384" for Debit Note), default to "396" if not specified. NOTE: Credit Note ("381", "393", "395") and Debit Note ("383", "384") represent adjustment documents and REQUIRE "billing_reference".
- billing_reference: REQUIRED for Credit Notes ("381", "393", "395") and Debit Notes ("383", "384"). Must contain an array of objects linking the credit/debit note to the original invoice(s), each object must have "irn" and "issue_date". Optional for other invoice types. Do not include empty array if not a Credit/Debit Note.
- document_currency_code: REQUIRED, default to "NGN"
- accounting_supplier_party: REQUIRED with party_name, tin, email, and postal_address, for outbound you should use business context if supplier information is not provided
- accounting_customer_party: REQUIRED with party_name, tin, email, and postal_address
- tax_total: REQUIRED - must include tax_amount and tax_subtotal array
- legal_monetary_total: REQUIRED with line_extension_amount, tax_exclusive_amount, tax_inclusive_amount, payable_amount
- invoice_line: REQUIRED array with at least one item

Ensure all keys above are not changed

## TAX TOTAL REQUIREMENTS (CRITICAL):
- tax_total MUST be present as an array with at least one object
- Each tax_total object must contain:
  * tax_amount: total tax amount for this tax type
  * tax_subtotal: array of tax breakdowns with taxable_amount, tax_amount, tax_category (id, percent)

## VALID TAX CATEGORIES:
${JSON.stringify(taxCategories, null, 2)}

## VALID INVOICE TYPES:
${JSON.stringify(invoiceTypes, null, 2)}

## DATE/TIME FORMATTING RULES:
1. ALL dates MUST be in YYYY-MM-DD format (e.g., "2024-05-14")
2. NEVER leave date fields empty or as empty strings
3. For missing dates in document references, use the main invoice's issue_date
4. Times must be in HH:MM:SS format

## AUTO-POPULATION RULES:
1. payment_status: default to "PENDING" if missing
2. document_currency_code: default to "NGN" if missing
3. tax_currency_code: default to "NGN" if missing
4. postal_zone: use "100001" if missing
5. telephone: ensure it starts with "+" (country code)
6. invoice_kind: default to "B2B" if missing

## PARTY INFORMATION RULES:
- accounting_supplier_party: MANDATORY (party_name, tin, email, postal_address)
- accounting_customer_party: MANDATORY (party_name, tin, email, postal_address)
- All party objects require: party_name, tin, email, postal_address
- Telephone must start with "+" if provided
- TIN format should be preserved from source

## FIELD METADATA REQUIREMENTS:
${JSON.stringify(FIRS_INVOICE_METADATA.category_summary, null, 2)}

                Return valid JSON only.
`;

    const response = await this.callLLM(prompt);

    const parsed = this.safeParseLLMJSON(response);

    // Validate that LLM did not modify identity fields during repair
    if (
      parsed.business_id !== undefined &&
      expectedBusinessId &&
      parsed.business_id !== expectedBusinessId
    ) {
      throw new InternalServerError(
        "LLM in repair attempted to modify the business_id identity field",
      );
    }
    if (parsed.irn !== undefined && expectedIrn && parsed.irn !== expectedIrn) {
      throw new InternalServerError(
        "LLM in repair attempted to modify the irn identity field",
      );
    }
    const parsedSupplierTIN = parsed.accounting_supplier_party?.tin;
    if (
      parsedSupplierTIN !== undefined &&
      expectedSupplierTIN &&
      parsedSupplierTIN !== expectedSupplierTIN
    ) {
      throw new InternalServerError(
        "LLM in repair attempted to modify the supplier TIN identity field",
      );
    }

    const repaired = { ...json, ...parsed };

    // Force-overwrite identity fields post-merge to prevent bypass
    if (expectedBusinessId) {
      repaired.business_id = expectedBusinessId;
    }
    if (expectedIrn) {
      repaired.irn = expectedIrn;
    }
    if (expectedSupplierTIN) {
      if (!repaired.accounting_supplier_party) {
        repaired.accounting_supplier_party = {};
      }
      repaired.accounting_supplier_party.tin = expectedSupplierTIN;
    }

    return repaired;
  }
}
