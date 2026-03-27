import { AuthContext } from "../../../middlewares";
import { ISchemaField, SchemaSourceType } from "../../../v1/workflow/models";
import { TransformWorkflowService } from "../../../v1/workflow/services/workflows/transform.service";
import { FIRS_INVOICE_METADATA, FIRS_INVOICE_SCHEMA } from "../../../v1/workflow/utils/defaults";
import { generateDatestamp, generateIRN } from "../../../v1/workflow/utils/transformer/utils";

export const DICTIONARY_PROMPT = (erp: string, payload: any, format: string = "CSV") => `
You are an Expert ${erp} ERP Data Analyst & Schema Extractor. Extract a complete field dictionary from an invoice payload.

# Input:
${JSON.stringify(payload)}

# Output:
Valid ${format} list of objects with the following fields/keys: field_id,field_path,data_type,format,validation_rules,description,example_value

# Field Rules
- field_id:lowercase snake_case, unique, semantic (not raw key names)
- field_path: JSON → JSONPath, XML → XPath, Nested → dot notation, Arrays → [*]
- data_type:String | Number | Boolean | Date | Object | Array
- format: Examples only if known YYYY-MM-DD, YYYY-MM-DDTHH:MM:SSZ, Decimal(2), Email, ISO-4217
- validation_rules: Pipe-separated if multiple: required, optional, unique, max_length=50, min_value=0, pattern=..., enum=a|b|c Blank if unknown.
- description: 1 short sentence describing business meaning.
- example_value: Prefer real payload value; otherwise realistic ERP value.


# IMPORTANT INSTRUCTIONS:
1. Extract every field, including metadata, and use the exact keys from the input, do not change the keys
2. Include parent objects and arrays
3. For arrays: input is already flattened and spread so describe accordingly
4. Do not infer missing fields
5. Avoid extra closing parentesis and also multiple root
6. Return ONLY valid ${format} in the exact dictionary format, do not include any other text or comments or special characters or html tags or any other formatting
7. Do not include any explanation, comments, or additional text   
8. Do not include any other text or comments or special characters or html tags or any other formatting (\\n, \\t, \\r, \\b, \\f, \\v)
9. Do not include escape sequence also, output should be parsable without errors
10. Ensure validity of the ${format}

# Failure Rule
If payload is invalid/empty: Output ${format} fields only
`;


/**
 * Format schema fields into a readable mapping guide for the LLM
 */
const formatSchemaFields = (fields: ISchemaField[], schemaName: string): string => {
    if (!fields || fields.length === 0) {
        return `No fields defined for ${schemaName}`;
    }

    const fieldLines = fields.map(field => {
        const required = field.is_required || field.validation_rules!.indexOf('required') > -1 ? 'REQUIRED' : 'optional';
        const format = field.format ? ` (format: ${field.format})` : '';
        const validation = field.validation_rules ? ` [${field.validation_rules}]` : '';
        const example = field.example_value !== undefined ? ` e.g., ${JSON.stringify(field.example_value)}` : '';

        return `  - ${field.field_id}: ${field.data_type}${format} | path: ${field.field_path} | ${required}${validation}${example}`;
    });

    return fieldLines.join('\n');
};

/**
 * Extract required fields from schema
 */
const getRequiredFields = (fields: ISchemaField[]): string[] => {
    return fields
        .filter(f => f.is_required || f.validation_rules!.indexOf('required') > -1)
        .map(f => f.field_id);
};

/**
 * Extract optional fields from schema
 */
const getOptionalFields = (fields: ISchemaField[]): string[] => {
    return fields
        .filter(f => !f.is_required)
        .map(f => f.field_id);
};

/**
 * FIRS Tax Categories reference
 */
export const FIRS_TAX_CATEGORIES = [
    { code: "STANDARD_VAT", value: "Standard Value-Added Tax", percent: "7.5" },
    { code: "REDUCED_VAT", value: "Reduced Value-Added Tax", percent: "7.5" },
    { code: "ZERO_VAT", value: "Zero Value-Added Tax", percent: "0.0" },
    { code: "STANDARD_GST", value: "Standard Goods and Services Tax", percent: "N/A" },
    { code: "REDUCED_GST", value: "Reduced Goods and Services Tax", percent: "N/A" },
    { code: "ZERO_GST", value: "Zero Goods and Services Tax", percent: "N/A" },
    { code: "STATE_SALES_TAX", value: "State Sales Tax", percent: "N/A" },
    { code: "LOCAL_SALES_TAX", value: "Local Sales Tax", percent: "N/A" },
    { code: "IMPORT_DUTY", value: "Import Duty", percent: "N/A" },
    { code: "EXPORT_DUTY", value: "Export Duty", percent: "N/A" },
    { code: "SERVICE_TAX", value: "Service Tax", percent: "N/A" },
];

/* FIRS Invoice Types reference */
export const FIRS_INVOICE_TYPES = [
    {
        "code": "380",
        "value": "Credit Note"
    },
    {
        "code": "381",
        "value": "Commercial Invoice"
    },
    {
        "code": "384",
        "value": "Debit Note"
    },
    {
        "code": "385",
        "value": "Self Billed Invoice"
    },
    {
        "code": "386",
        "value": "Factored Invoice"
    },
    {
        "code": "388",
        "value": "Statement of Account"
    },
    {
        "code": "389",
        "value": "Purchase Order"
    },
    {
        "code": "390",
        "value": "Proforma Invoice"
    },
    {
        "code": "392",
        "value": "Consignment Invoice"
    },
    {
        "code": "393",
        "value": "Self-billed Credit Note"
    },
    {
        "code": "394",
        "value": "Self-billed Invoice"
    },
    {
        "code": "395",
        "value": "Credit Note Request"
    },
    {
        "code": "396",
        "value": "Invoice Request"
    },
    {
        "code": "397",
        "value": "Final Settlement"
    },
    {
        "code": "399",
        "value": "Bill of Lading"
    },
    {
        "code": "400",
        "value": "Waybill"
    },
    {
        "code": "402",
        "value": "Shipping Instructions"
    },
    {
        "code": "404",
        "value": "Certificate of Origin"
    },
    {
        "code": "406",
        "value": "Customs Declaration"
    },
    {
        "code": "408",
        "value": "Packing List"
    }
]

/**
 * Generate transformation prompt using schemas from database
 * @param invoice - The input invoice data to transform
 * @param authContext - Authentication context with tenant/business info
 * @param sourceSchema - Pre-fetched source ERP schema fields (optional)
 * @param firsSchema - Pre-fetched FIRS UBL schema fields (optional)
 * @param mappingRules - Mapping Rules customized for current client
 */
export const SYSTEM_PROMPT_V2 = (
    invoice: any,
    authContext?: AuthContext,
    sourceSchema?: ISchemaField[],
    firsSchema?: ISchemaField[],
    mappingRules?: Array<Record<string, any>>,
    metaContext?: string
): string => {
    const today = new Date().toISOString().slice(0, 10);
    const invoiceRef = `INV${new Date().toISOString().slice(0, 10).replace(/-/g, '')}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
    let irn = generateIRN(
        invoiceRef,
        authContext?.serviceId,
        invoice.issueDate ? new Date(invoice.issueDate) : undefined,
    );
    // Build source schema section
    let sourceSchemaSection = '';
    if (sourceSchema && sourceSchema.length > 0) {
        const sourceRequired = getRequiredFields(sourceSchema);
        const sourceOptional = getOptionalFields(sourceSchema);
        sourceSchemaSection = `
## SOURCE ERP SCHEMA FIELDS:
${formatSchemaFields(sourceSchema, 'Source ERP')}

Source Required Fields: ${sourceRequired.join(', ') || 'None specified'}
Source Optional Fields: ${sourceOptional.join(', ') || 'None specified'}
`;
    }

    // Build FIRS schema section
    let firsSchemaSection = '';
    if (firsSchema && firsSchema.length > 0) {
        const firsRequired = getRequiredFields(firsSchema);
        const firsOptional = getOptionalFields(firsSchema);
        firsSchemaSection = `
## TARGET FIRS UBL SCHEMA FIELDS:
${formatSchemaFields(firsSchema, 'FIRS UBL')}

FIRS Required Fields: ${firsRequired.join(', ') || 'None specified'}
FIRS Optional Fields: ${firsOptional.join(', ') || 'None specified'}
`;
    }
    // Build business context section
    let businessContext = '';
    if (authContext) {
        irn = generateIRN(
        invoiceRef,
        authContext?.serviceId,
        invoice.issueDate ? new Date(invoice.issueDate) : undefined,
    )
        businessContext = `
            ## BUSINESS CONTEXT:
            - Business ID: ${authContext.businessId || '{{TEST_BUSINESS_ID}}'}
            - Tenant ID: ${authContext.tenantId || 'N/A'}
            - Tenant Business Name: ${authContext.businessName}
            - Tenant Business TIN: ${authContext.businessTIN}
            - Service ID: ${authContext?.serviceId}
            - Default IRN: ${irn}
            `;
    }

    return `You are an expert data transformation AI specializing in Nigerian FIRS (Federal Inland Revenue Service) e-invoicing compliance. Transform the provided invoice data into the exact FIRS UBL schema format.

${businessContext}
${sourceSchemaSection}
${firsSchemaSection}

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

## INVOICE LINE ITEM RULES:
Each invoice_line must contain:
- hsn_code: product/service classification code
- product_category: category name
- invoiced_quantity: quantity (number)
- line_extension_amount: line total before tax
- item: object with name, description
- price: object with price_amount, base_quantity, price_unit

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

## MAPPING RULES TO USE INCASE THE FIELDS EXIST:
${JSON.stringify(mappingRules)}


## INPUT INVOICE DATA TO TRANSFORM:
${JSON.stringify(invoice, null, 2)}

${metaContext|| ""}

Transform the input data to match the FIRS UBL schema exactly. Return only valid JSON.`;
};

/**
 * Async version that fetches schemas from database before generating prompt
 * @param invoice - The input invoice data to transform
 * @param authContext - Authentication context with tenant/business info
 * @param sourceType - The source ERP type (e.g., SAP, ORACLE, ZOHO)
 */
export const generateTransformPrompt = async (
    invoice: any,
    authContext?: AuthContext,
    sourceType?: SchemaSourceType | string,
    sourceSchema?: ISchemaField[] | undefined,
     metaContext?: string
): Promise<string> => {
    const transformService = new TransformWorkflowService();

    //let sourceSchema: ISchemaField[] = [];
    let mappingRules: Array<Record<string, any>> = [];
    let firsSchema: ISchemaField[] = [];

    try {
        // Fetch source ERP schema if source type is provided
        if (!sourceSchema && sourceType) {
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
    } catch (error) {
        console.error('Error fetching schemas for prompt generation:', error);
        // Continue with empty schemas - prompt will use defaults
    }

    return SYSTEM_PROMPT_V2(invoice, authContext, sourceSchema, firsSchema, mappingRules, metaContext);
};