import { aiConfig, firsConfig } from "../../../../@config";
import { FIRSService } from "../../../../@lib/adapters/firs/firs.service";
import { AuthContext } from "../../../../middlewares";
import { TenantService } from "../../../tenants/services/tenant.service";
import { ISchemaField, InvoiceSchemaDictionaryDocument, SchemaSourceType, SchemaStatus } from "../../models";
import { InvoiceSchemaDictionaryRepository, CreateSchemaDictionaryInput, UpdateSchemaDictionaryInput } from "../../repos/invoice-schema-dictionary.repo";
import { FIRSInvoiceTransformer } from "../../utils/transformer";

/**
 * Input for upserting invoice schema
 */
export interface UpsertSchemaInput {
    schema_id: string;
    name: string;
    description?: string;
    source_type: SchemaSourceType | string;
    fields: ISchemaField[];
    status?: SchemaStatus;
    tenant_id?: string;
    metadata?: Record<string, any>;
    mapping_rules?: Array<Record<string, any>>;
    created_by?: string;
}

export class TransformWorkflowService {
    private tenantService: TenantService;
    private invoiceSchemaRepo: InvoiceSchemaDictionaryRepository

    constructor() {
        this.tenantService = new TenantService();
        this.invoiceSchemaRepo = new InvoiceSchemaDictionaryRepository();
    }

    /**
     * Transform invoice from source ERP format to FIRS UBL format
     * @param invoice - The raw invoice data to transform
     * @param authContext - Authentication context with tenant/business info
     * @param sourceType - The source ERP type for schema-based transformation (optional)
     */
    transformInvoice = async (invoice: any, authContext?: AuthContext, sourceType?: SchemaSourceType | string): Promise<any> => {
        const transformer = new FIRSInvoiceTransformer(aiConfig?.openAIApiKey!, aiConfig?.openApiEndpoint!);

        const result = await transformer.transformAndValidate(invoice, authContext, sourceType);
        console.log({ result })
        if (result?.success) {

            // Data is valid and ready to send to FIRS
            const parsedData = JSON.parse(JSON.stringify(result.data)); // Valid JSON

            console.log({ parsedData })
            return parsedData;
            // Send to FIRS
            //await transformer.sendToFIRS(result.data, 'https://firs-api.com');
        } else {
            // Handle validation errors
            console.error('Errors:', result?.errors);
            throw result?.errors
        }
    }

    /**
     * Upsert (create or update) an invoice schema dictionary
     * If schema exists, updates it; otherwise creates a new one
     */
    upsertInvoiceSchema = async (
        sourceType: SchemaSourceType | string,
        schemaPayload: Partial<UpsertSchemaInput>
    ): Promise<InvoiceSchemaDictionaryDocument> => {
        // Generate schema_id if not provided
        const schemaId = schemaPayload.schema_id || this.generateSchemaId(sourceType);

        // Check if schema already exists
        const existingSchema = await this.invoiceSchemaRepo.findBySchemaId(schemaId);

        if (existingSchema) {
            // Update existing schema
            const updatePayload: UpdateSchemaDictionaryInput = {
                updated_by: schemaPayload.created_by || 'system',
            };

            if (schemaPayload.name) updatePayload.name = schemaPayload.name;
            if (schemaPayload.description) updatePayload.description = schemaPayload.description;
            if (schemaPayload.fields) updatePayload.fields = schemaPayload.fields;
            if (schemaPayload.status) updatePayload.status = schemaPayload.status;
            if (schemaPayload.metadata) updatePayload.metadata = schemaPayload.metadata;
            if (schemaPayload.mapping_rules) updatePayload.mapping_rules = schemaPayload.mapping_rules;

            console.log({updatePayload})
            const updated = await this.invoiceSchemaRepo.update(schemaId, updatePayload);
            console.log(`Updated schema dictionary: ${schemaId}`);
            return updated;
        } else {
            // Create new schema
            const createPayload: CreateSchemaDictionaryInput = {
                schema_id: schemaId,
                name: schemaPayload.name || this.getDefaultSchemaName(sourceType),
                description: schemaPayload.description || `Invoice schema for ${sourceType}`,
                source_type: sourceType,
                fields: schemaPayload.fields || [],
                status: schemaPayload.status || SchemaStatus.DRAFT,
                tenant_id: schemaPayload.tenant_id,
                metadata: schemaPayload.metadata || {},
                created_by: schemaPayload.created_by || 'system',
            };

            const created = await this.invoiceSchemaRepo.create(createPayload);
            console.log(`Created schema dictionary: ${schemaId}`);
            return created;
        }
    }

    /**
     * Upsert ERP-specific invoice schema
     */
    upsertERPSchema = async (
        erpType: string,
        fields: ISchemaField[],
        options?: {
            tenantId?: string;
            status?: SchemaStatus,
            createdBy?: string;
            metadata?: Record<string, any>;
            mapping_rules?: Array<Record<string, any>>;
        }
    ): Promise<InvoiceSchemaDictionaryDocument> => {
        // Normalize ERP type to uppercase
        const normalizedErp = erpType.toUpperCase().replace(/-/g, '_');
        const sourceType = (SchemaSourceType as any)[normalizedErp] || normalizedErp;

        return this.upsertInvoiceSchema(sourceType, {
            schema_id: `${normalizedErp}_INVOICE_SCHEMA`,
            name: `${erpType} Invoice Schema`,
            description: `Invoice field mapping schema for ${erpType} ERP system`,
            source_type: sourceType,
            fields,
            status: options?.status || SchemaStatus.DRAFT,
            tenant_id: options?.tenantId,
            created_by: options?.createdBy || 'system',
            metadata: {
                erp_type: erpType,
                ...options?.metadata,
            },
            mapping_rules: options?.mapping_rules || []
        });
    }

    /**
     * Upsert FIRS UBL invoice schema
     */
    upsertFIRSSchema = async (
        fields: ISchemaField[],
        options?: {
            createdBy?: string;
            metadata?: Record<string, any>;
        }
    ): Promise<InvoiceSchemaDictionaryDocument> => {
        return this.upsertInvoiceSchema(SchemaSourceType.FIRS_UBL, {
            schema_id: 'FIRS_UBL_INVOICE_SCHEMA',
            name: 'FIRS UBL Invoice Schema',
            description: 'Nigerian FIRS Universal Business Language invoice schema',
            source_type: SchemaSourceType.FIRS_UBL,
            fields,
            status: SchemaStatus.ACTIVE, // FIRS schema should be active by default
            created_by: options?.createdBy || 'system',
            metadata: {
                standard: 'UBL 2.1',
                jurisdiction: 'Nigeria',
                ...options?.metadata,
            },
        });
    }

    /**
     * Get invoice schema by source type
     */
    getInvoiceSchema = async (
        sourceType: SchemaSourceType | string
    ): Promise<InvoiceSchemaDictionaryDocument | null> => {
        // Try to find default schema for this source type
        const defaultSchema = await this.invoiceSchemaRepo.findDefaultBySourceType(sourceType);
        if (defaultSchema) return defaultSchema;

        // If no default, try to find any active schema
        const schemas = await this.invoiceSchemaRepo.findBySourceType(sourceType, true);
        return schemas.length > 0 ? schemas[0] : null;
    }

    /**
     * Get invoice schema by schema ID
     */
    getInvoiceSchemaById = async (schemaId: string): Promise<InvoiceSchemaDictionaryDocument | null> => {
        return this.invoiceSchemaRepo.findBySchemaId(schemaId);
    }

    /**
     * List all invoice schemas with optional filtering
     */
    listInvoiceSchemas = async (
        filters?: {
            sourceType?: SchemaSourceType | string;
            status?: SchemaStatus;
            tenantId?: string;
        },
        page: number = 1,
        limit: number = 20
    ) => {
        return this.invoiceSchemaRepo.findMany(
            {
                source_type: filters?.sourceType,
                status: filters?.status,
                tenant_id: filters?.tenantId,
            },
            limit,
            page
        );
    }

    /**
     * Activate a schema (set status to ACTIVE)
     */
    activateSchema = async (schemaId: string, updatedBy: string = 'system'): Promise<InvoiceSchemaDictionaryDocument> => {
        return this.invoiceSchemaRepo.setStatus(schemaId, SchemaStatus.ACTIVE, updatedBy);
    }

    /**
     * Set a schema as default for its source type
     */
    setSchemaAsDefault = async (schemaId: string, updatedBy: string = 'system'): Promise<InvoiceSchemaDictionaryDocument> => {
        return this.invoiceSchemaRepo.setAsDefault(schemaId, updatedBy);
    }

    /**
     * Delete an invoice schema
     */
    deleteInvoiceSchema = async (schemaId: string): Promise<boolean> => {
        return this.invoiceSchemaRepo.delete(schemaId);
    }

    /**
     * Get all supported ERP types with their schema status
     */
    getSupportedERPTypes = async () => {
        return this.invoiceSchemaRepo.getSourceTypesSummary();
    }

    /**
     * Generate a unique schema ID based on source type
     */
    private generateSchemaId(sourceType: SchemaSourceType | string): string {
        const normalized = sourceType.toString().toUpperCase().replace(/[^A-Z0-9]/g, '_');
        return `${normalized}_INVOICE_SCHEMA`;
    }

    /**
     * Get default schema name based on source type
     */
    private getDefaultSchemaName(sourceType: SchemaSourceType | string): string {
        const typeStr = sourceType.toString();
        // Convert SNAKE_CASE to Title Case
        return typeStr
            .split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ') + ' Invoice Schema';
    }
}
