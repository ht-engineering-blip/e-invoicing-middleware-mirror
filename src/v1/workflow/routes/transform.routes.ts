import Elysia from "elysia";
import { requireAuth } from "../../../middlewares";
import { TenantService } from "../../tenants/services/tenant.service";
import { TransformWorkflowService } from "../services/workflows/transform.service";
import jsonSpread from "json-spread";
import { LLMService } from "../../../@lib/adapters/llm/llm.service";
import { AppError, ResponseBuilder } from "../../../@lib";
import { onlyAdmin } from "../../auth/utils/access-checks";
import { secureAndValidateInvoice } from "../utils/security";
import {
  transformInvoiceValidation,
  configureERPDictionaryValidation,
  configureFIRSDictionaryValidation,
  generateMappingValidation,
  testMappingValidation,
  saveMappingValidation,
} from "../validations/transform.validation";
import type {
  MappingTemplate,
  FieldMappingRule,
  ArrayMappingRule,
} from "../utils/transformer/mapping-spec.types";
import { NRSSchemaRegistry } from "../utils/transformer/nrs-schema-registry";

/**
 * Admin-protected tenant routes
 * All mutation operations require admin key
 */
const transformInvoiceRoutes = new Elysia({ prefix: "/transform" })
  .use(requireAuth)
  .decorate("tenantService", new TenantService())
  .decorate("transformWorkflowService", new TransformWorkflowService())
  .decorate("llmService", new LLMService())

  /**
   * POST /api/v1/workflow/transform
   * Run transform invoice workflow
   */
  .post(
    "/",
    async ({ auth, body, transformWorkflowService, set }) => {
      try {
        const { invoice: rawInvoice, source_type }: any = body;
        const invoice = secureAndValidateInvoice(
          rawInvoice as SecureInvoice,
          auth,
        );

        let transformedPayload =
          await transformWorkflowService.transformInvoiceV2(
            invoice,
            auth,
            source_type,
          );

        return ResponseBuilder.success(transformedPayload);
      } catch (error: any) {
        set.status = error.statusCode || 500;
        return ResponseBuilder.error(error.message, error.statusCode || 500);
      }
    },
    transformInvoiceValidation,
  )

  /**
   * GET /api/v1/workflow/transform/nrs-schemas
   * List available NRS target schema versions and required fields
   */
  .get("/nrs-schemas", async ({ transformWorkflowService }) => {
    return ResponseBuilder.success(await transformWorkflowService.getNRSSchemas());
  })

  /**
   * POST /api/v1/workflow/transform/mapping/generate
   * Generate a proposed MappingTemplate using LLM (One-time during onboarding)
   */
  .post(
    "/mapping/generate",
    async ({ auth, body, llmService, transformWorkflowService, set }) => {
      try {
        onlyAdmin(auth!);
        const { erp, sample_invoice, nrs_version }: any = body;

        const firsSchemaDoc =
          await transformWorkflowService.getInvoiceSchema("FIRS_UBL");
        const targetNrsData =
          firsSchemaDoc?.fields ||
          NRSSchemaRegistry.getSchema(nrs_version || "v1.0")?.fields;

        const generatedTemplate = await llmService.generateMappingTemplate(
          erp,
          sample_invoice,
          nrs_version || "v1.0",
          targetNrsData,
        );

        return ResponseBuilder.success({
          erp_source: erp,
          template: generatedTemplate,
        });
      } catch (error: any) {
        set.status = error.statusCode || 500;
        return ResponseBuilder.error(error.message, error.statusCode || 500);
      }
    },
    generateMappingValidation,
  )

  /**
   * POST /api/v1/workflow/transform/mapping/test
   * Test a MappingTemplate on a sample invoice payload without saving
   */
  .post(
    "/mapping/test",
    async ({ auth, body, transformWorkflowService, set }) => {
      try {
        onlyAdmin(auth!);
        const { sample_invoice, template }: any = body;

        const result = await transformWorkflowService.testMappingTemplate(
          sample_invoice,
          template as MappingTemplate,
          auth,
        );

        return ResponseBuilder.success(result);
      } catch (error: any) {
        set.status = error.statusCode || 500;
        return ResponseBuilder.error(error.message, error.statusCode || 500);
      }
    },
    testMappingValidation,
  )

  /**
   * POST /api/v1/workflow/transform/mapping/save
   * Strictly validates sample payload against NRS rules before saving and activating ERP mapping
   */
  .post(
    "/mapping/save",
    async ({ auth, body, transformWorkflowService, set }) => {
      try {
        onlyAdmin(auth!);
        const { erp, template, sample_invoice }: any = body;

        const savedSchema = await transformWorkflowService.saveMappingTemplate(
          erp,
          template as MappingTemplate,
          sample_invoice,
          {
            tenantId: auth?.tenantId,
            createdBy: auth?.userId || "system",
          },
          auth,
        );

        return ResponseBuilder.success({
          schema_id: savedSchema.schema_id,
          erp_source: erp,
          status: savedSchema.status,
          message:
            "ERP Mapping verified against NRS schema and activated successfully",
        });
      } catch (error: any) {
        set.status = error.statusCode || 500;
        return ResponseBuilder.error(
          error.message,
          error.statusCode || 500,
          error.details || error.data,
        );
      }
    },
    saveMappingValidation,
  );

/* Dictionary Configuration */
transformInvoiceRoutes
  /**
   * POST /api/v1/workflow/transform/dictionary/erp
   * Update erp invoice dictionary and mapping template (supports manual or llm mapping)
   */
  .post(
    "/dictionary/erp",
    async ({
      auth,
      body,
      query,
      llmService,
      transformWorkflowService,
      set,
    }) => {
      try {
        onlyAdmin(auth!);
        const {
          erp,
          invoice: rawInvoice,
          mapping_type = "manual",
          mapping_template,
          mapping_rules,
          metadata,
        } = body as {
          erp: string;
          invoice: unknown;
          mapping_type?: "manual" | "llm";
          mapping_template?: MappingTemplate;
          mapping_rules?: FieldMappingRule[];
          metadata?: Record<string, unknown> &
            Partial<MappingTemplate> & {
              template?: MappingTemplate;
              field_mappings?: FieldMappingRule[];
              array_mappings?: ArrayMappingRule[];
            };
        };

        const invoice = secureAndValidateInvoice(
          rawInvoice as SecureInvoice,
          auth,
        );

        let finalTemplate: MappingTemplate;

        const candidateTemplate: Partial<MappingTemplate> | undefined =
          mapping_template ||
          (metadata && Array.isArray(metadata.field_mappings)
            ? (metadata as MappingTemplate)
            : undefined) ||
          (metadata && metadata.template ? metadata.template : undefined) ||
          (metadata && Array.isArray(metadata.array_mappings)
            ? (metadata as MappingTemplate)
            : undefined);

        if (mapping_type === "llm") {
          // Option A: LLM-Assisted Mapping Generation
          finalTemplate = await llmService.generateMappingTemplate(
            erp,
            invoice,
          );
        } else {
          // Option B: Manual Mapping
          if (
            candidateTemplate &&
            (Array.isArray(candidateTemplate.field_mappings) ||
              Array.isArray(candidateTemplate.array_mappings))
          ) {
            finalTemplate = {
              erp_source: candidateTemplate.erp_source || erp,
              nrs_schema_version:
                candidateTemplate.nrs_schema_version || "v1.0",
              field_mappings: candidateTemplate.field_mappings || [],
              array_mappings: candidateTemplate.array_mappings || [],
              constants: candidateTemplate.constants || {},
            };
          } else if (Array.isArray(mapping_rules) && mapping_rules.length > 0) {
            const fieldMappings: FieldMappingRule[] = [];
            const arrayMappingsMap = new Map<string, ArrayMappingRule>();

            for (const r of mapping_rules) {
              if (
                r.source &&
                r.source.includes("[*]") &&
                r.target &&
                r.target.includes("[*]")
              ) {
                const [srcArr, ...srcRest] = r.source.split("[*].");
                const [tgtArr, ...tgtRest] = r.target.split("[*].");
                const key = `${srcArr}->${tgtArr}`;
                if (!arrayMappingsMap.has(key)) {
                  arrayMappingsMap.set(key, {
                    source_array: srcArr,
                    target_array: tgtArr,
                    item_mappings: [],
                  });
                }
                arrayMappingsMap.get(key)!.item_mappings.push({
                  source: srcRest.join("[*]."),
                  target: tgtRest.join("[*]."),
                  transform: r.transform,
                  default_value: r.default_value,
                  fallback_sources: r.fallback_sources,
                });
              } else {
                fieldMappings.push(r);
              }
            }

            finalTemplate = {
              erp_source: erp,
              nrs_schema_version: "v1.0",
              field_mappings: fieldMappings,
              array_mappings: Array.from(arrayMappingsMap.values()),
            };
          } else {
            throw new AppError(
              400,
              "For manual mapping, 'mapping_template' or 'mapping_rules' must be provided",
              "MISSING_MAPPING_RULES",
            );
          }
        }

        // Strict Gatekeeper: Validates sample invoice against NRS schema before saving
        const savedSchema = await transformWorkflowService.saveMappingTemplate(
          erp,
          finalTemplate,
          invoice,
          {
            tenantId: auth?.tenantId,
            createdBy: auth?.userId || "system",
          },
          auth,
        );

        return ResponseBuilder.success({
          schema_id: savedSchema.schema_id,
          erp_type: erp,
          mapping_type,
          template: finalTemplate,
          status: savedSchema.status,
          message:
            "ERP mapping verified against NRS schema and activated successfully",
        });
      } catch (error: any) {
        set.status = error.statusCode || 500;
        return ResponseBuilder.error(
          error.message,
          error.statusCode || 500,
          error.details || error.data,
        );
      }
    },
    configureERPDictionaryValidation,
  )
  /**
   * POST /api/v1/workflow/transform/dictionary/firs
   * Configure FIRS invoice dictionary for use in transformation operations
   */
  .post(
    "/dictionary/firs",
    async ({
      auth,
      body,
      query,
      llmService,
      transformWorkflowService,
      set,
    }) => {
      try {
        onlyAdmin(auth!);
        let { invoice, metadata }: any = body;

        // Flatten the invoice and metadata for field extraction
        let flatInvoice = jsonSpread(invoice)[0];
        let invoiceKeyTypes: any = {};
        let flatMetadata = metadata ? jsonSpread(metadata)[0] : {};
        flatMetadata.dataTypes = invoiceKeyTypes;

        // Generate FIRS invoice dictionary using LLM
        let generatedFields = await llmService.generateInvoiceDictionary(
          "firs",
          invoice,
          flatMetadata,
        );

        // Upsert the FIRS schema to database
        const savedSchema = await transformWorkflowService.upsertFIRSSchema(
          generatedFields,
          {
            createdBy: auth?.userId || "system",
            metadata: {
              source_invoice_sample:
                metadata && metadata.source_invoice_sample
                  ? metadata.source_invoice_sample
                  : flatInvoice,
              source_metadata_sample: flatMetadata,
              generated_at: new Date().toISOString(),
            },
          },
        );

        return ResponseBuilder.success({
          schema_id: savedSchema.schema_id,
          name: savedSchema.name,
          fields_count: generatedFields.length,
          fields: generatedFields,
          status: savedSchema.status,
        });
      } catch (error: any) {
        set.status = error.statusCode || 500;
        return ResponseBuilder.error(error.message, error.statusCode || 500);
      }
    },
    configureFIRSDictionaryValidation,
  );

export default transformInvoiceRoutes;
