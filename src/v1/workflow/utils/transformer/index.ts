import { z } from 'zod';
import { generateIRN, SYSTEM_PROMPT } from './utils';
import { aiConfig } from '../../../../@config';
import { BadRequestError, InternalServerError } from '../../../../@lib';
import { AuthContext } from '../../../../middlewares';
import { generateTransformPrompt } from '../../../../@lib/adapters/llm/prompts';
import { SchemaSourceType } from '../../models';
// ============= SCHEMA VALIDATION =============

// Simplified validation schemas for critical fields
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format. Must be YYYY-MM-DD");
const TimeSchema = z.string().regex(/^\d{2}:\d{2}:\d{2}$/, "Invalid time format. Must be HH:MM:SS");
const PhoneSchema = z.string().regex(/^\+/, "Phone must start with + (country code)").optional();

const AddressSchema = z.object({
  street_name: z.string(),
  city_name: z.string(),
  postal_zone: z.string(),
  country: z.string()
});

const PartySchema = z.object({
  party_name: z.string(),
  tin: z.string(),
  email: z.string().email(),
  telephone: PhoneSchema,
  business_description: z.string().optional(),
  postal_address: AddressSchema
});

const TaxSubtotalSchema = z.object({
  taxable_amount: z.number(),
  tax_amount: z.number(),
  tax_category: z.object({
    id: z.string(),
    percent: z.number()
  })
});

const TaxTotalSchema = z.object({
  tax_amount: z.number(),
  tax_subtotal: z.array(TaxSubtotalSchema).min(1)
});

const LegalMonetaryTotalSchema = z.object({
  line_extension_amount: z.number(),
  tax_exclusive_amount: z.number(),
  tax_inclusive_amount: z.number(),
  payable_amount: z.number()
});

const InvoiceLineSchema = z.object({
  hsn_code: z.string(),
  product_category: z.string(),
  invoiced_quantity: z.number(),
  line_extension_amount: z.number(),
  item: z.object({
    name: z.string(),
    description: z.string(),
    sellers_item_identification: z.string().optional()
  }),
  price: z.object({
    price_amount: z.number(),
    base_quantity: z.number(),
    price_unit: z.string()
  }),
  discount_rate: z.number().optional(),
  discount_amount: z.number().optional(),
  fee_rate: z.number().optional(),
  fee_amount: z.number().optional()
});

// Main FIRS Schema for validation
const FIRSInvoiceSchema = z.object({
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
  tax_currency_code: z.string().optional(),
  accounting_cost: z.string().optional(),
  buyer_reference: z.string().optional(),
  invoice_delivery_period: z.object({
    start_date: DateSchema,
    end_date: DateSchema
  }).optional(),
  order_reference: z.string().optional(),
  billing_reference: z.array(z.object({
    irn: z.string(),
    issue_date: DateSchema
  })).optional(),
  dispatch_document_reference: z.object({
    irn: z.string(),
    issue_date: DateSchema
  }).optional(),
  receipt_document_reference: z.object({
    irn: z.string(),
    issue_date: DateSchema
  }).optional(),
  originator_document_reference: z.object({
    irn: z.string(),
    issue_date: DateSchema
  }).optional(),
  contract_document_reference: z.object({
    irn: z.string(),
    issue_date: DateSchema
  }).optional(),
  additional_document_reference: z.array(z.object({
    irn: z.string(),
    issue_date: DateSchema
  })).optional(),
  actual_delivery_date: DateSchema.optional(),
  payment_means: z.array(z.object({
    payment_means_code: z.union([z.string(), z.number()]),
    payment_due_date: DateSchema
  })).optional(),
  payment_terms_note: z.string().optional(),
  allowance_charge: z.array(z.object({
    charge_indicator: z.boolean(),
    amount: z.number()
  })).optional(),
  invoice_reference: z.string().optional()
});

// ============= SYSTEM PROMPT =============

const FIRS_SCHEMA_EXAMPLE = `{
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
            "hsn_code": "CC-001",
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

const createSystemPrompt = (invoiceData: any): string => {
  const today = new Date().toISOString().slice(0, 10);
  const invoiceRef = `INV${new Date().toISOString().slice(0, 10).replace(/-/g, '')}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;

  return `You are an expert data transformation AI. Transform the following invoice data into the exact FIRS (Federal Inland Revenue Service) e-invoicing schema format.

CRITICAL REQUIREMENTS:

MANDATORY FIELDS (MUST BE PRESENT):
- business_id: Use "{{TEST_BUSINESS_ID}}" if not provided
- irn: Generate a unique invoice reference if not provided (format: INVYYYYMMDDXXX)
- issue_date: REQUIRED, use today (${today}) if not provided
- invoice_type_code: REQUIRED, default to "396" if not specified
- document_currency_code: REQUIRED, default to "NGN"
- accounting_supplier_party: REQUIRED with party_name, tin, email, and postal_address, these can be from supplier or vendor details
- accounting_customer_party: REQUIRED with party_name, tin, email, and postal_address, these can be derived from customer details on the input payload
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

VALID tax categories:
 [
        {
            "code": "STANDARD_GST",
            "value": "Standard Goods and Services Tax",
            "percent": "Not Available"
        },
        {
            "code": "REDUCED_GST",
            "value": "Reduced Goods and Services Tax",
            "percent": "Not Available"
        },
        {
            "code": "ZERO_GST",
            "value": "Zero Goods and Services Tax",
            "percent": "Not Available"
        },
        {
            "code": "STANDARD_VAT",
            "value": "Standard Value-Added Tax",
            "percent": "7.5"
        },
        {
            "code": "REDUCED_VAT",
            "value": "Reduced Value-Added Tax",
            "percent": "7.5"
        },
        {
            "code": "ZERO_VAT",
            "value": "Zero Value-Added Tax",
            "percent": "0.0"
        },
        {
            "code": "STATE_SALES_TAX",
            "value": "State Sales Tax",
            "percent": "Not Available"
        },
        {
            "code": "LOCAL_SALES_TAX",
            "value": "Local Sales Tax",
            "percent": "Not Available"
        },
        {
            "code": "ALCOHOL_EXCISE_TAX",
            "value": "Alcohol Excise Tax",
            "percent": "Not Available"
        },
        {
            "code": "TOBACCO_EXCISE_TAX",
            "value": "Tobacco Excise Tax",
            "percent": "Not Available"
        },
        {
            "code": "FUEL_EXCISE_TAX",
            "value": "Fuel Excise Tax",
            "percent": ""
        },
        {
            "code": "CORPORATE_INCOME_TAX",
            "value": "Corporate Income Tax",
            "percent": "Not Available"
        },
        {
            "code": "PERSONAL_INCOME_TAX",
            "value": "Personal Income Tax",
            "percent": "Not Available"
        },
        {
            "code": "SOCIAL_SECURITY_TAX",
            "value": "Social Security Tax",
            "percent": "Not Available"
        },
        {
            "code": "MEDICARE_TAX",
            "value": "Medicare Tax",
            "percent": ""
        },
        {
            "code": "REAL_ESTATE_TAX",
            "value": "Real Estate Tax",
            "percent": "Not Available"
        },
        {
            "code": "PERSONAL_PROPERTY_TAX",
            "value": "Personal Property Tax",
            "percent": "Not Available"
        },
        {
            "code": "CARBON_TAX",
            "value": "Carbon Tax",
            "percent": "Not Available"
        },
        {
            "code": "PLASTIC_TAX",
            "value": "Plastic Tax",
            "percent": "Not Available"
        },
        {
            "code": "IMPORT_DUTY",
            "value": "Import Duty",
            "percent": "Not Available"
        },
        {
            "code": "EXPORT_DUTY",
            "value": "Export Duty",
            "percent": "Not Available"
        },
        {
            "code": "LUXURY_TAX",
            "value": "Luxury Tax",
            "percent": "Not Available"
        },
        {
            "code": "SERVICE_TAX",
            "value": "Service Tax",
            "percent": "Not Available"
        },
        {
            "code": "TOURISM_TAX",
            "value": "Tourism Tax",
            "percent": "Not Available"
        }
    ]




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
${JSON.stringify(invoiceData, null, 2)}

Transform the input data to match the FIRS schema exactly. Return only the JSON`;
};

// ============= MAIN TRANSFORMER CLASS =============

interface TransformationResult {
  success: boolean;
  data?: any;
  missing_fields?: any;
  errors?: string[];
  validationErrors?: z.ZodError;
}

export class FIRSInvoiceTransformer {
  private apiKey: string;
  private apiEndpoint: string;

  constructor(apiKey: string, apiEndpoint: string = 'https://api.openai.com/v1/chat/completions') {
    this.apiKey = apiKey;
    this.apiEndpoint = apiEndpoint;
    console.log({ endpoint: this.apiEndpoint })
    console.log({ key: this.apiKey })
  }

  /**
   * Transform invoice data using LLM
   */
  private async transformWithLLM(invoiceData: any, authContext?: AuthContext, sourceType?: SchemaSourceType | string): Promise<any> {
    // Generate the transformation prompt using schemas from database
    const systemPrompt = await generateTransformPrompt(invoiceData, authContext, sourceType);
    console.log("====================================================")
    console.log(systemPrompt)
    console.log("====================================================")
    /*  const today = new Date().toISOString().slice(0, 10);
     const invoiceRef = `INV${new Date().toISOString().slice(0, 10).replace(/-/g, '')}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
  */
    //const systemPrompt = SYSTEM_PROMPT(invoiceData, today, invoiceRef);
    //const systemPrompt = SYSTEM_PROMPT_V2(invoiceData,authContext);
    //const systemPrompt = createSystemPrompt(invoiceData);

    const response = await fetch(this.apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: aiConfig?.inferenceModel,
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user', content: `Transform and validate the data to give me valid FIRS schema format with all the mandatory fields and all the optional fields and all the validation rules and all the formatting rules and all the auto-population rules and all the optional field handling rules and all the party information rules and all the tax categories and all the important instructions and all the FIRS schema example and all the input invoice data.

            Always find the relevant fields to the mandatory fields before generating placeholders.

            do not use null, all null fields should be excluded.
            ` }
        ],
        temperature: 0.0001,
        max_tokens: 4000,
        response_format: { type: "json_object" }
      })
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
      throw new Error('Failed to parse LLM response as JSON');
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
  async transformAndValidate(invoiceData: any, authContext?: AuthContext, sourceType?: SchemaSourceType | string): Promise<TransformationResult | undefined> {
    try {
      // Step 1: Transform using LLM with schema-based prompts
      console.log('Transforming invoice data...');
      const transformedData = await this.transformWithLLM(invoiceData, authContext, sourceType);
      // Step 2: Validate the transformed data
      console.log('Validating transformed data...');
      const validation = this.validateData(transformedData);
      console.log(JSON.stringify(transformedData, undefined, 2))
      if (validation.isValid) {
        return {
          success: true,
          data: transformedData
        };
      } else {
        // Attempt to fix validation errors and retry once
        console.log('Validation failed, attempting to fix...');
        const fixedData = this.attemptAutoFix(transformedData, validation.errors!);

        // Re-validate fixed data
        const reValidation = this.validateData(fixedData);

        if (reValidation.isValid) {
          return {
            success: true,
            data: fixedData
          };
        } else {
          return {
            success: false,
            data: fixedData,
            errors: this.formatValidationErrors(reValidation.errors!),
            validationErrors: reValidation.errors
          };
        }
      }
    } catch (error) {
      throw new InternalServerError(`Transformation failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
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
      const path = issue.path.join('.');

      // Fix missing mandatory fields
      if (issue.code === 'invalid_type' && issue.expected === 'string') {
        if (path === 'business_id') {
          fixed.business_id = '{{TEST_BUSINESS_ID}}';
          /*  } else if (path === 'irn') {
             fixed.irn = generateIRN(); */
        } else if (path === 'issue_date') {
          fixed.issue_date = new Date().toISOString().slice(0, 10);
        } else if (path === 'invoice_type_code') {
          fixed.invoice_type_code = '396';
        } else if (path === 'document_currency_code') {
          fixed.document_currency_code = 'NGN';
        }
      }

      // Fix missing tax_total
      if (path === 'tax_total' && (!fixed.tax_total || !Array.isArray(fixed.tax_total))) {
        fixed.tax_total = [{
          tax_amount: 0,
          tax_subtotal: [{
            taxable_amount: 0,
            tax_amount: 0,
            tax_category: {
              id: 'ZERO_VAT',
              percent: 0
            }
          }]
        }];
      }

      // Fix tax_category.percent string to number conversion
      if (issue.code === 'invalid_type' && issue.expected === 'number' && path.includes('tax_category.percent')) {
        const pathParts = issue.path.map(p => String(p));
        const currentValue = this.getNestedProperty(fixed, pathParts);
        if (typeof currentValue === 'string') {
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
      if (issue.message && issue.message.includes('Invalid date format')) {
        const pathParts = path.split('.');
        const fieldName = pathParts[pathParts.length - 1];
        if (fieldName.includes('date')) {
          this.setNestedProperty(fixed, pathParts, new Date().toISOString().slice(0, 10));
        }
      }
    }

    console.log({ fixed })
    return fixed;
  }

  /**
   * Helper method to set nested property
   */
  private setNestedProperty(obj: any, path: string[], value: any): void {
    let current = obj;
    for (let i = 0; i < path.length - 1; i++) {
      if (!current[path[i]]) {
        current[path[i]] = {};
      }
      current = current[path[i]];
    }
    current[path[path.length - 1]] = value;
  }

  /**
   * Helper method to get nested property
   */
  private getNestedProperty(obj: any, path: string[]): any {
    let current = obj;
    for (const key of path) {
      if (current && typeof current === 'object' && key in current) {
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
    return errors.issues.map(issue => {
      const path = issue.path.join('.');
      return `${path}: ${issue.message}`;
    });
  }

  /**
   * Send validated invoice to FIRS API
   */
  async sendToFIRS(validatedData: any, firsApiEndpoint: string): Promise<any> {
    const response = await fetch(`${firsApiEndpoint}/api/v1/invoice/validate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Add any required authentication headers
      },
      body: JSON.stringify(validatedData)
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