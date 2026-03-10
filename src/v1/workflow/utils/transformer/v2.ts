import { z } from "zod"
import { AuthContext } from "../../../../middlewares"
import { ISchemaField, SchemaSourceType } from "../../models"
import { TransformWorkflowService } from "../../services"
import { FIRSInvoiceSchema, TransformationResult } from "."
import { InternalServerError, logger } from "../../../../@lib"
import { generateDatestamp, generateIRN } from "./utils"
import { FIRS_INVOICE_METADATA } from "../defaults"
import { FIRS_INVOICE_TYPES, FIRS_TAX_CATEGORIES } from "../../../../@lib/adapters/llm/prompts"

/* -----------------------------------------------------
 CLASS
----------------------------------------------------- */

export class FIRSInvoiceTransformerV2 {

    private apiKey: string
    private apiEndpoint: string

    constructor(
        apiKey: string,
        apiEndpoint: string = "https://api.openai.com/v1/chat/completions"
    ) {
        this.apiKey = apiKey
        this.apiEndpoint = apiEndpoint
    }

    /**
     * Transformation and validation method
     * @param invoiceData - The raw invoice data to transform
     * @param authContext - Authentication context with tenant/business info
     * @param sourceType - The source ERP type (e.g., SAP, ORACLE, ZOHO) for schema-based transformation
     */
    async transformAndValidate(invoice: any, authContext?: AuthContext, sourceType?: SchemaSourceType | string): Promise<TransformationResult | undefined> {
        const transformService = new TransformWorkflowService();

        let sourceSchema: ISchemaField[] = [];
        let mappingRules: Array<Record<string, any>> = [];
        let firsSchema: ISchemaField[] = [];


        try {

            // Fetch source ERP schema if source type is provided
            if (sourceType) {
                const sourceSchemaDoc = await transformService.getInvoiceSchema(sourceType);
                if (sourceSchemaDoc) {
                    sourceSchema = sourceSchemaDoc.fields;
                    mappingRules = sourceSchemaDoc.mapping_rules || []
                }
            }

            // Fetch FIRS UBL schema
            const firsSchemaDoc = await transformService.getInvoiceSchema(SchemaSourceType.FIRS_UBL);
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
                FIRSInvoiceSchema
            )


            console.log('Transforming invoice data...');

            if (!result.success) {

                console.error(result.error)

            }

            console.log({ result })
            const transformedData = result.data;
            return {
                success: true,
                data: transformedData
            };

        } catch (error) {
            throw new InternalServerError(`Transformation failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
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
        firsZodSchema: z.ZodSchema
    ) {

        try {

            const schemaGraph = this.buildSchemaGraph(firsSchema)
            logger.info("Schema Graph", schemaGraph)

            const mapped = this.deterministicTransform(invoice, mappingRules)
            logger.info("Mapped", mapped)
            const base = { ...invoice, ...mapped }
            logger.info("base", base)
            const resolved = this.ensureRequiredFields(base, firsSchema)
            logger.info("resolved", resolved)
            const missing = this.findMissingFields(resolved, firsSchema)
            logger.info("missing", missing)
            let completed = resolved
            logger.info("completed", completed)
            if (missing.length > 0) {

                const prompt = this.buildSchemaAwarePrompt(
                    resolved,
                    authContext,
                    sourceSchema,
                    firsSchema,
                    missing
                )
                //logger.info("prompt", prompt)
                const response = await this.callLLM(prompt)
                logger.info("response", response)
                const parsed = this.safeParseLLMJSON(response)
                logger.info("parsed", parsed)
                completed = { ...resolved, ...parsed }
                logger.info("completed", completed)
            }

            const validation = this.validateWithZod(
                completed,
                firsZodSchema
            )
            logger.info("validation", validation)

            if (!validation.valid) {

                completed = await this.repairJSON(
                    completed,
                    validation.errors
                )

            }

            logger.info("final", completed)

            return {
                success: true,
                data: completed
            }

        } catch (err: any) {

            return {
                success: false,
                error: err.message,
                originalInvoice: invoice
            }

        }

    }

    /* -----------------------------------------------------
     SCHEMA GRAPH
    ----------------------------------------------------- */

    private buildSchemaGraph(schema: ISchemaField[]) {

        const graph: Record<string, string[]> = {}

        for (const field of schema) {

            if (!field.parent_field_id) continue

            if (!graph[field.parent_field_id]) {
                graph[field.parent_field_id] = []
            }

            graph[field.parent_field_id].push(field.field_path)

        }

        return graph
    }

    /* -----------------------------------------------------
     OBJECT UTILITIES
    ----------------------------------------------------- */

    private flattenObject(
        obj: Record<string, any>,
        prefix = "",
        res: Record<string, any> = {}
    ) {

        for (const key in obj) {

            const prop = prefix ? `${prefix}.${key}` : key

            if (
                typeof obj[key] === "object" &&
                !Array.isArray(obj[key])
            ) {

                this.flattenObject(obj[key], prop, res)

            } else {

                res[prop] = obj[key]

            }

        }

        return res
    }

    private setDeepValue(obj: any, path: string, value: any) {

        const keys = path.replace("[*]", "").split(".")

        let current = obj

        keys.forEach((key, i) => {

            if (i === keys.length - 1) {

                current[key] = value
                return

            }

            if (!current[key]) current[key] = {}

            current = current[key]

        })

    }

    private getDeepValue(obj: any, path: string) {

        const keys = path.replace("[*]", "").split(".")

        let current = obj

        for (const key of keys) {

            if (!current) return undefined

            current = current[key]

        }

        return current
    }

    /* -----------------------------------------------------
     RULE MAPPING ENGINE
    ----------------------------------------------------- */

    private deterministicTransform(
        invoice: any,
        mappingRules: any[]
    ) {

        const flat = this.flattenObject(invoice)

        const result: Record<string, any> = {}

        for (const rule of mappingRules || []) {


            const value = flat[rule.source]
            console.log({ rule, value })
            if (value !== undefined) {

                this.setDeepValue(result, rule.target, value)

            }

        }

        return result
    }

    /* -----------------------------------------------------
     REQUIRED FIELD RESOLUTION
    ----------------------------------------------------- */

    private ensureRequiredFields(
        data: any,
        schema: ISchemaField[]
    ) {

        for (const field of schema) {
            console.log({ field })
            let fieldRequired = field.is_required || field.validation_rules!.indexOf('required') > -1;

            if (!fieldRequired) continue

            const existing = this.getDeepValue(
                data,
                field.field_path
            )

            if (
                existing === undefined &&
                field.default_value !== undefined
            ) {

                this.setDeepValue(
                    data,
                    field.field_path,
                    field.default_value
                )

            }

        }

        return data
    }

    /* -----------------------------------------------------
     MISSING FIELD DETECTION
    ----------------------------------------------------- */

    private findMissingFields(
        data: any,
        schema: ISchemaField[]
    ) {

        const missing: string[] = []

        for (const field of schema) {
            let fieldRequired = field.is_required || field.validation_rules!.indexOf('required') > -1;

            if (!fieldRequired) continue

            const value = this.getDeepValue(
                data,
                field.field_path
            )

            if (value === undefined) {

                missing.push(field.field_path)

            }

        }

        return missing
    }

    /* -----------------------------------------------------
     SCHEMA AWARE PROMPT BUILDER
    ----------------------------------------------------- */

    private buildSchemaAwarePrompt(
        invoice: any,
        authContext: AuthContext,
        sourceSchema: ISchemaField[],
        firsSchema: ISchemaField[],
        missingFields: string[]
    ) {

        const requiredFields = firsSchema
            .filter(f => f.is_required || f.validation_rules!.indexOf('required') > -1)
            .map(f => ({
                path: f.field_path,
                type: f.data_type,
                enum: f.enum_values,
                example: f.example_value,
                description: f.description
            }))

        const today = new Date().toISOString().slice(0, 10);
        const invoiceRef = `INV${new Date().toISOString().slice(0, 10).replace(/-/g, '')}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
        let irn = generateIRN(
            invoiceRef,
            authContext?.serviceId,
            invoice.issueDate ? new Date(invoice.issueDate) : undefined,
        );
       let  businessContext = `
            ## BUSINESS CONTEXT:
            - Business ID: ${authContext.businessId || '{{TEST_BUSINESS_ID}}'}
            - Tenant ID: ${authContext.tenantId || 'N/A'}
            - Tenant Business Name: ${authContext.businessName}
            - Tenant Business TIN: ${authContext.businessTIN}
            - Service ID: ${authContext?.serviceId}
            - Default IRN: ${irn}
            `;
        return `
You are a Nigerian FIRS UBL invoice transformation engine.

Only return valid JSON.

--------------------------------

BUSINESS CONTEXT
${JSON.stringify(authContext)}
${businessContext}

--------------------------------

MISSING FIELDS
${JSON.stringify(missingFields)}

--------------------------------

TARGET FIRS REQUIRED FIELDS

${JSON.stringify(requiredFields, null, 2)}

--------------------------------

SOURCE ERP SCHEMA
${JSON.stringify(sourceSchema, null, 2)}

--------------------------------

INPUT INVOICE
${JSON.stringify(invoice, null, 2)}

--------------------------------
# FIRS INVOICE TRANSFORMATION RULES

## MANDATORY FIELDS (MUST BE PRESENT) do not change the field names:
- business_id: Use "${authContext?.businessId || '{{TEST_BUSINESS_ID}}'}"
- irn: Generate unique reference if not provided, use "${irn}" as default
- irn should follow the format {invoiceReference}-{ServiceID}-${generateDatestamp(invoice?.date || invoice?.issue_date || new Date())}
- issue_date: REQUIRED, use today (${today}) if not provided
- invoice_type_code: REQUIRED, derive from invoice payload and map to the right VALID INVOICE TYPES default to "396" if not specified
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
${JSON.stringify(FIRS_TAX_CATEGORIES, null, 2)}

## VALID INVOICE TYPES:
${JSON.stringify(FIRS_INVOICE_TYPES, null, 2)}

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
12. DO not return 'undefined', instead put the approriate empty values


Transform the input data to match the FIRS UBL schema exactly. Return only valid JSON

Complete the missing fields.
`
    }

    /* -----------------------------------------------------
     LLM CALL
    ----------------------------------------------------- */

    private async callLLM(prompt: string) {

        const response = await fetch(this.apiEndpoint, {

            method: "POST",

            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.apiKey}`
            },

            body: JSON.stringify({
                model: "gpt-4o-mini",
                temperature: 0,
                max_tokens: 4000,
                response_format: { type: "json_object" },
                messages: [
                    {
                        role: "system",
                        content:
                            "You are a strict JSON generator."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ]
            })

        })

        const json = await response.json()

        return json.choices[0].message.content
    }

    /* -----------------------------------------------------
     JSON PARSER
    ----------------------------------------------------- */

    private safeParseLLMJSON(text: string) {

        const cleaned = text
            .replace(/```json/g, "")
            .replace(/```/g, "")
            .trim()

        return JSON.parse(cleaned)
    }

    /* -----------------------------------------------------
     ZOD VALIDATION
    ----------------------------------------------------- */

    private validateWithZod(
        data: any,
        schema: z.ZodSchema
    ) {

        const result = schema.safeParse(data)

        if (result.success) {

            return {
                valid: true,
                data: result.data
            }

        }

        return {
            valid: false,
            errors: result.error.flatten()
        }

    }

    /* -----------------------------------------------------
     REPAIR ENGINE
    ----------------------------------------------------- */

    private async repairJSON(
        json: any,
        errors: any
    ) {

        const prompt = `
                The JSON below failed validation.

                Errors:
                ${JSON.stringify(errors)}

                Fix the JSON.

                JSON:
                ${JSON.stringify(json)}

                Return valid JSON only.
`

        const response = await this.callLLM(prompt)

        return this.safeParseLLMJSON(response)

    }

}