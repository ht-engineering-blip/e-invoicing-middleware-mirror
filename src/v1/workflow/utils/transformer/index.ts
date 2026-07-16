import { z } from "zod";
import { aiConfig } from "../../../../@config";
import { InternalServerError } from "../../../../@lib";
import { generateTransformPrompt } from "../../../../@lib/adapters/llm/prompts";
import { AuthContext } from "../../../../middlewares";
import { SchemaSourceType } from "../../models";
import { generateIRN, sanitizeInvoiceIRNs, sanitizeHsnCode } from "./utils";
// ============= SCHEMA VALIDATION =============

// Simplified validation schemas for critical fields
const DateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format. Must be YYYY-MM-DD");
const TimeSchema = z
  .string()
  .regex(/^\d{2}:\d{2}:\d{2}$/, "Invalid time format. Must be HH:MM:SS");
const PhoneSchema = z
  .string()
  .regex(/^\+/, "Phone must start with + (country code)")
  .optional();

const AddressSchema = z.object({
  street_name: z.string(),
  city_name: z.string(),
  postal_zone: z.string(),
  country: z.string(),
});

const PartySchema = z.object({
  party_name: z.string(),
  tin: z.string(),
  email: z.string().email(),
  telephone: PhoneSchema,
  business_description: z.string().optional(),
  postal_address: AddressSchema,
});

const TaxSubtotalSchema = z.object({
  taxable_amount: z.number(),
  tax_amount: z.number(),
  tax_category: z.object({
    id: z.string(),
    percent: z.number(),
  }),
});

const TaxTotalSchema = z.object({
  tax_amount: z.number(),
  tax_subtotal: z.array(TaxSubtotalSchema).min(1),
});

const LegalMonetaryTotalSchema = z.object({
  line_extension_amount: z.number(),
  tax_exclusive_amount: z.number(),
  tax_inclusive_amount: z.number(),
  payable_amount: z.number(),
});

const InvoiceLineSchema = z.object({
  hsn_code: z.preprocess(
    (val) => (val === undefined || val === null ? "" : String(val).trim()),
    z
      .string()
      .transform((val) => {
        if (!val) return "";
        const sanitized = sanitizeHsnCode(val);
        if (sanitized) return sanitized;
        return val;
      })
      .optional(),
  ),
  product_category: z.string(),
  invoiced_quantity: z.number(),
  line_extension_amount: z.number(),
  item: z.object({
    name: z.string(),
    description: z.string(),
    sellers_item_identification: z.string().optional(),
  }),
  price: z.object({
    price_amount: z.number(),
    base_quantity: z.number(),
    price_unit: z.string(),
  }),
  discount_rate: z.number().optional(),
  discount_amount: z.number().optional(),
  fee_rate: z.number().optional(),
  fee_amount: z.number().optional(),
});

// Main FIRS Schema for validation
export const FIRSInvoiceSchema = z
  .object({
    business_id: z.string(),
    irn: z.string(),
    issue_date: DateSchema,
    invoice_type_code: z.string(),
    document_currency_code: z.string(),
    accounting_supplier_party: PartySchema,
    accounting_customer_party: PartySchema,
    tax_total: z.array(TaxTotalSchema).min(1),
    legal_monetary_total: LegalMonetaryTotalSchema,
    invoice_line: z.array(InvoiceLineSchema).min(1),

    // Optional fields
    due_date: DateSchema.optional(),
    issue_time: TimeSchema.optional(),
    payment_status: z.string().optional(),
    note: z.string().optional(),
    tax_point_date: DateSchema.optional(),
    tax_currency_code: z.string(),
    accounting_cost: z.string().optional(),
    buyer_reference: z.string().optional(),
    invoice_delivery_period: z
      .object({
        start_date: DateSchema,
        end_date: DateSchema,
      })
      .optional(),
    order_reference: z.string().optional(),
    billing_reference: z
      .array(
        z.object({
          irn: z.string(),
          issue_date: DateSchema,
        }),
      )
      .optional(),
    dispatch_document_reference: z
      .object({
        irn: z.string(),
        issue_date: DateSchema,
      })
      .optional(),
    receipt_document_reference: z
      .object({
        irn: z.string(),
        issue_date: DateSchema,
      })
      .optional(),
    originator_document_reference: z
      .object({
        irn: z.string(),
        issue_date: DateSchema,
      })
      .optional(),
    contract_document_reference: z
      .object({
        irn: z.string(),
        issue_date: DateSchema,
      })
      .optional(),
    additional_document_reference: z
      .array(
        z.object({
          irn: z.string(),
          issue_date: DateSchema,
        }),
      )
      .optional(),
    actual_delivery_date: DateSchema.optional(),
    payment_means: z
      .array(
        z.object({
          payment_means_code: z.union([z.string(), z.number()]),
          payment_due_date: DateSchema,
        }),
      )
      .optional(),
    payment_terms_note: z.string().optional(),
    allowance_charge: z
      .array(
        z.object({
          charge_indicator: z.boolean(),
          amount: z.number(),
        }),
      )
      .optional(),
    invoice_reference: z.string().optional(),
  })
  .refine(
    (data) => {
      if (data.invoice_type_code === "381") {
        return (
          Array.isArray(data.billing_reference) &&
          data.billing_reference.length > 0
        );
      }
      return true;
    },
    {
      message:
        "billing_reference is required and must link to the original invoice when invoice_type_code is '381' (Credit Note)",
      path: ["billing_reference"],
    },
  );

// ============= MAIN TRANSFORMER CLASS =============

export interface TransformationResult {
  success: boolean;
  data?: any;
  missing_fields?: any;
  errors?: string[];
  validationErrors?: z.ZodError;
}

export class FIRSInvoiceTransformer {
  private apiKey: string;
  private apiEndpoint: string;

  constructor(
    apiKey: string,
    apiEndpoint: string = "https://api.openai.com/v1/chat/completions",
  ) {
    this.apiKey = apiKey;
    this.apiEndpoint = apiEndpoint;
    console.log({ endpoint: this.apiEndpoint });
    console.log({ key: this.apiKey });
  }

  /**
   * Transform invoice data using LLM
   */
  private async transformWithLLM(
    invoiceData: any,
    authContext?: AuthContext,
    sourceType?: SchemaSourceType | string,
  ): Promise<any> {
    // Generate the transformation prompt using schemas from database
    const systemPrompt = await generateTransformPrompt(
      invoiceData,
      authContext,
      sourceType,
    );
    console.log("====================================================");
    console.log(systemPrompt);
    console.log("====================================================");
    /*  const today = new Date().toISOString().slice(0, 10);
     const invoiceRef = `INV${new Date().toISOString().slice(0, 10).replace(/-/g, '')}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
  */
    //const systemPrompt = SYSTEM_PROMPT(invoiceData, today, invoiceRef);
    //const systemPrompt = SYSTEM_PROMPT_V2(invoiceData,authContext);
    //const systemPrompt = createSystemPrompt(invoiceData);

    const response = await fetch(this.apiEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: aiConfig?.inferenceModel,
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: `Transform and validate the data to give me valid FIRS schema format with all the mandatory fields and all the optional fields and all the validation rules and all the formatting rules and all the auto-population rules and all the optional field handling rules and all the party information rules and all the tax categories and all the important instructions and all the FIRS schema example and all the input invoice data.

            Always find the relevant fields to the mandatory fields before generating placeholders.

            do not use null, all null fields should be excluded.
            `,
          },
        ],
        temperature: 0.0001,
        max_tokens: 4000,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      throw new Error(`LLM API error: ${response.statusText}`);
    }

    const result = await response.json();
    const content = result.choices[0].message.content;

    // Parse the JSON response
    try {
      return JSON.parse(content);
    } catch (error) {
      throw new Error("Failed to parse LLM response as JSON");
    }
  }

  /**
   * Validate the transformed data against FIRS schema
   */
  private validateData(data: any): { isValid: boolean; errors?: z.ZodError } {
    try {
      FIRSInvoiceSchema.parse(data);
      return { isValid: true };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return { isValid: false, errors: error };
      }
      throw error;
    }
  }

  /**
   * Main transformation and validation method
   * @param invoiceData - The raw invoice data to transform
   * @param authContext - Authentication context with tenant/business info
   * @param sourceType - The source ERP type (e.g., SAP, ORACLE, ZOHO) for schema-based transformation
   */
  async transformAndValidate(
    invoiceData: any,
    authContext?: AuthContext,
    sourceType?: SchemaSourceType | string,
  ): Promise<TransformationResult | undefined> {
    try {
      // Set expected identity fields securely
      const expectedBusinessId = authContext?.businessId;
      const expectedSupplierTIN = authContext?.businessTIN;
      const todayStr = new Date().toISOString().slice(0, 10);
      const invoiceRef =
        invoiceData.invoice_reference ||
        `INV${todayStr.replace(/-/g, "")}${Math.floor(Math.random() * 1000)
          .toString()
          .padStart(3, "0")}`;
      const computedIrn = generateIRN(
        invoiceRef,
        authContext?.serviceId,
        invoiceData.date || invoiceData.issue_date || invoiceData.issueDate
          ? new Date(
              invoiceData.date ||
                invoiceData.issue_date ||
                invoiceData.issueDate,
            )
          : undefined,
      );
      const expectedIrn = invoiceData.irn || computedIrn;

      // Step 1: Transform using LLM with schema-based prompts
      console.log("Transforming invoice data...");
      const transformedData = await this.transformWithLLM(
        invoiceData,
        authContext,
        sourceType,
      );

      // Deterministic HSN code sanitization
      if (Array.isArray(transformedData.invoice_line)) {
        for (const line of transformedData.invoice_line) {
          if (line.hsn_code !== undefined && line.hsn_code !== null) {
            const sanitized = sanitizeHsnCode(line.hsn_code);
            if (sanitized !== undefined) {
              line.hsn_code = sanitized;
            }
          }
        }
      }

      // Warn if LLM modified identity fields — force-overwrite below will correct them
      if (
        transformedData.business_id !== undefined &&
        expectedBusinessId &&
        transformedData.business_id !== expectedBusinessId
      ) {
        console.warn(
          `[Transformer] LLM changed business_id from "${expectedBusinessId}" to "${transformedData.business_id}" — will be overwritten`,
        );
      }
      if (
        transformedData.irn !== undefined &&
        expectedIrn &&
        transformedData.irn !== expectedIrn
      ) {
        console.warn(
          `[Transformer] LLM changed irn from "${expectedIrn}" to "${transformedData.irn}" — will be overwritten`,
        );
      }
      const parsedSupplierTIN = transformedData.accounting_supplier_party?.tin;
      if (
        parsedSupplierTIN !== undefined &&
        expectedSupplierTIN &&
        parsedSupplierTIN !== expectedSupplierTIN
      ) {
        console.warn(
          `[Transformer] LLM changed supplier TIN from "${expectedSupplierTIN}" to "${parsedSupplierTIN}" — will be overwritten`,
        );
      }

      // Force-overwrite identity fields post-merge to prevent bypass
      if (expectedBusinessId) {
        transformedData.business_id = expectedBusinessId;
      }
      if (expectedIrn) {
        transformedData.irn = expectedIrn;
      }
      if (expectedSupplierTIN) {
        if (!transformedData.accounting_supplier_party) {
          transformedData.accounting_supplier_party = {};
        }
        transformedData.accounting_supplier_party.tin = expectedSupplierTIN;
      }

      // Step 2: Validate the transformed data
      console.log("Validating transformed data...");
      sanitizeInvoiceIRNs(transformedData);
      const validation = this.validateData(transformedData);
      console.log(JSON.stringify(transformedData, undefined, 2));
      if (validation.isValid) {
        return {
          success: true,
          data: transformedData,
        };
      } else {
        // Attempt to fix validation errors and retry once
        console.log("Validation failed, attempting to fix...");
        const fixedData = this.attemptAutoFix(
          transformedData,
          validation.errors!,
        );

        // Force-overwrite identity fields on fixedData to prevent bypass in auto-fix
        if (expectedBusinessId) {
          fixedData.business_id = expectedBusinessId;
        }
        if (expectedIrn) {
          fixedData.irn = expectedIrn;
        }
        if (expectedSupplierTIN) {
          if (!fixedData.accounting_supplier_party) {
            fixedData.accounting_supplier_party = {};
          }
          fixedData.accounting_supplier_party.tin = expectedSupplierTIN;
        }

        // Deterministic HSN code sanitization post-autofix
        if (Array.isArray(fixedData.invoice_line)) {
          for (const line of fixedData.invoice_line) {
            if (line.hsn_code !== undefined && line.hsn_code !== null) {
              const sanitized = sanitizeHsnCode(line.hsn_code);
              if (sanitized !== undefined) {
                line.hsn_code = sanitized;
              }
            }
          }
        }

        // Re-validate fixed data
        sanitizeInvoiceIRNs(fixedData);
        const reValidation = this.validateData(fixedData);

        if (reValidation.isValid) {
          return {
            success: true,
            data: fixedData,
          };
        } else {
          return {
            success: false,
            data: fixedData,
            errors: this.formatValidationErrors(reValidation.errors!),
            validationErrors: reValidation.errors,
          };
        }
      }
    } catch (error) {
      throw new InternalServerError(
        `Transformation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      /*  {
         success: false,
         errors: [`Transformation failed: ${error instanceof Error ? error.message : 'Unknown error'}`]
       }; */
    }
  }

  /**
   * Attempt to automatically fix common validation errors
   */
  private attemptAutoFix(data: any, errors: z.ZodError): any {
    const fixed = { ...data };

    for (const issue of errors.issues) {
      const path = issue.path.join(".");

      // Fix missing mandatory fields
      if (issue.code === "invalid_type" && issue.expected === "string") {
        if (path === "business_id") {
          fixed.business_id = "{{TEST_BUSINESS_ID}}";
          /*  } else if (path === 'irn') {
             fixed.irn = generateIRN(); */
        } else if (path === "issue_date") {
          fixed.issue_date = new Date().toISOString().slice(0, 10);
        } else if (path === "invoice_type_code") {
          const original = data.invoice_type_code;
          fixed.invoice_type_code =
            original === "381" || original === "380" || original === "384"
              ? original
              : "396";
        } else if (path === "document_currency_code") {
          fixed.document_currency_code = "NGN";
        }
      }

      // Fix missing tax_total
      if (
        path === "tax_total" &&
        (!fixed.tax_total || !Array.isArray(fixed.tax_total))
      ) {
        fixed.tax_total = [
          {
            tax_amount: 0,
            tax_subtotal: [
              {
                taxable_amount: 0,
                tax_amount: 0,
                tax_category: {
                  id: "ZERO_VAT",
                  percent: 0,
                },
              },
            ],
          },
        ];
      }

      // Fix tax_category.percent string to number conversion
      if (
        issue.code === "invalid_type" &&
        issue.expected === "number" &&
        path.includes("tax_category.percent")
      ) {
        const pathParts = issue.path.map((p) => String(p));
        const currentValue = this.getNestedProperty(fixed, pathParts);
        if (typeof currentValue === "string") {
          const numericValue = parseFloat(currentValue);
          if (!isNaN(numericValue)) {
            this.setNestedProperty(fixed, pathParts, numericValue);
          } else {
            // Default to 0 if string cannot be converted
            this.setNestedProperty(fixed, pathParts, 0);
          }
        }
      }

      // Fix date format issues
      if (issue.message && issue.message.includes("Invalid date format")) {
        const pathParts = path.split(".");
        const fieldName = pathParts[pathParts.length - 1];
        if (fieldName.includes("date")) {
          this.setNestedProperty(
            fixed,
            pathParts,
            new Date().toISOString().slice(0, 10),
          );
        }
      }
    }

    console.log({ fixed });
    return fixed;
  }

  /**
   * Helper method to set nested property
   */
  private setNestedProperty(obj: any, path: string[], value: any): void {
    let current = obj;
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i];
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        continue;
      }
      if (!current[key]) {
        current[key] = {};
      }
      current = current[key];
    }
    const finalKey = path[path.length - 1];
    if (finalKey !== '__proto__' && finalKey !== 'constructor' && finalKey !== 'prototype') {
      current[finalKey] = value;
    }
  }

  /**
   * Helper method to get nested property
   */
  private getNestedProperty(obj: any, path: string[]): any {
    let current = obj;
    for (const key of path) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        return undefined;
      }
      if (current && typeof current === "object" && key in current) {
        current = current[key];
      } else {
        return undefined;
      }
    }
    return current;
  }

  /**
   * Format validation errors for better readability
   */
  private formatValidationErrors(errors: z.ZodError): string[] {
    return errors.issues.map((issue) => {
      const path = issue.path.join(".");
      return `${path}: ${issue.message}`;
    });
  }

  /**
   * Send validated invoice to FIRS API
   */
  async sendToFIRS(validatedData: any, firsApiEndpoint: string): Promise<any> {
    const response = await fetch(`${firsApiEndpoint}/api/v1/invoice/validate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Add any required authentication headers
      },
      body: JSON.stringify(validatedData),
    });

    if (!response.ok) {
      throw new Error(`FIRS API error: ${response.statusText}`);
    }

    return await response.json();
  }
}

// ============= USAGE EXAMPLE =============

/*
// Example usage:
const transformer = new FIRSInvoiceTransformer('your-api-key');

const inputInvoice = {
  supplier: {
    name: "ABC Company",
    tax_id: "12345678",
    email: "supplier@example.com",
    address: "123 Main St, Lagos"
  },
  customer: {
    name: "XYZ Ltd",
    tax_id: "87654321",
    email: "customer@example.com",
    address: "456 Business Ave, Abuja"
  },
  items: [
    {
      description: "Product A",
      quantity: 10,
      unit_price: 100,
      total: 1000
    }
  ],
  total: 1000,
  tax: 75,
  grand_total: 1075
};

// Transform and validate
const result = await transformer.transformAndValidate(inputInvoice);

if (result.success) {
  console.log('Transformation successful!');
  console.log('Validated data:', JSON.stringify(result.data, null, 2));
  
  // Send to FIRS API
  const firsResponse = await transformer.sendToFIRS(
    result.data, 
    'https://firs-api.example.com'
  );
  console.log('FIRS Response:', firsResponse);
} else {
  console.error('Transformation failed!');
  console.error('Errors:', result.errors);
  if (result.validationErrors) {
    console.error('Validation details:', result.validationErrors.format());
  }
}
*/
