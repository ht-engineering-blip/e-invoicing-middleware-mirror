import { generateRandomString, logger, BaseService } from "../../../@lib";
import {
  AppError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../../../@lib/errors";
import { SystemConfigRepository } from "../repos/system-config.repo";
import {
  SystemConfigKey,
  IERPConfiguration,
} from "../models/system-config.model";
import { TransformWorkflowService } from "../../workflow/services/workflows/transform.service";
import { FIRSService } from "../../../@lib/adapters/firs/firs.service";
import { AuthContext } from "../../../middlewares";
import { InvoiceSchemaDictionaryDocument } from "../../workflow/models";
import { generateIRN } from "../../workflow/utils/transformer/utils";
import { AuditEventType, AuditEventSeverity } from "../../audit/models";
import { TTLCache } from "../../shared/utils";

export class SystemConfigService extends BaseService {
  private configRepo: SystemConfigRepository;
  private transformService: TransformWorkflowService;
  private firsService: FIRSService;

  // TTL cache for system configs to avoid repetitive Mongo reads
  private configCache = new TTLCache<string, any>({
    maxItems: 50,
    defaultTtlMs: 300_000, // 5 minutes
  });

  constructor(dependencies?: {
    configRepo?: SystemConfigRepository;
    transformService?: TransformWorkflowService;
    firsService?: FIRSService;
  }) {
    super();
    this.configRepo = dependencies?.configRepo ?? new SystemConfigRepository();
    this.transformService = dependencies?.transformService ?? new TransformWorkflowService();
    this.firsService = dependencies?.firsService ?? new FIRSService();
  }

  // ==================== FIRS Dictionary Management ====================

  /**
   * Get FIRS Dictionary Schema with caching
   */
  async getFIRSDictionary(): Promise<any> {
    try {
      const cacheKey = SystemConfigKey.FIRS_DICTIONARY;
      const cached = this.configCache.get(cacheKey);
      if (cached !== undefined) return cached;

      const config = await this.configRepo.getByKey(
        SystemConfigKey.FIRS_DICTIONARY,
      );

      if (!config) {
        const fallback = {
          schema: null,
          version: 0,
          message: "FIRS dictionary not configured",
        };
        this.configCache.set(cacheKey, fallback);
        return fallback;
      }

      const result = {
        schema: config.configValue,
        version: config.version,
        updatedAt: config.updatedAt,
        updatedBy: config.updatedBy,
      };

      this.configCache.set(cacheKey, result);
      return result;
    } catch (error: any) {
      logger.error("Error fetching FIRS dictionary", { error: error.message });
      throw new AppError(500, "Failed to fetch FIRS dictionary");
    }
  }

  /**
   * Update FIRS Dictionary Schema
   */
  async updateFIRSDictionary(
    schema: Record<string, any>,
    updatedBy: string = "admin",
  ): Promise<any> {
    try {
      if (!schema || typeof schema !== "object") {
        throw new ValidationError("Invalid schema format");
      }

      this.configCache.delete(SystemConfigKey.FIRS_DICTIONARY);

      const config = await this.configRepo.upsert(
        SystemConfigKey.FIRS_DICTIONARY,
        schema,
        {
          description: "FIRS UBL Invoice Schema Dictionary",
          updatedBy,
        },
      );

      await this.createAuditLog({
        tenantId: "system",
        eventType: AuditEventType.SYSTEM_WARNING,
        severity: AuditEventSeverity.INFO,
        actorType: "user",
        actorId: updatedBy,
        actorName: updatedBy,
        resourceType: "system_config",
        resourceId: SystemConfigKey.FIRS_DICTIONARY,
        resourceName: "FIRS Dictionary",
        description: `FIRS dictionary updated (v${config.version})`,
        metadata: {
          version: config.version,
          payload: schema,
        },
      });

      logger.info("FIRS dictionary updated", {
        version: config.version,
        updatedBy,
      });

      const result = {
        success: true,
        schema: config.configValue,
        version: config.version,
        updatedAt: config.updatedAt,
      };

      this.configCache.set(SystemConfigKey.FIRS_DICTIONARY, result);
      return result;
    } catch (error: any) {
      logger.error("Error updating FIRS dictionary", { error: error.message });
      if (error instanceof ValidationError) throw error;
      throw new AppError(500, "Failed to update FIRS dictionary");
    }
  }

  // ==================== ERP Configuration Management ====================

  /**
   * Get all supported ERPs with caching
   */
  async getSupportedERPs(): Promise<IERPConfiguration[]> {
    try {
      const cacheKey = SystemConfigKey.SUPPORTED_ERPS;
      const cached = this.configCache.get(cacheKey);
      if (cached !== undefined) return cached;

      const config = await this.configRepo.getByKey(
        SystemConfigKey.SUPPORTED_ERPS,
      );

      const result = (config?.configValue || []) as IERPConfiguration[];
      this.configCache.set(cacheKey, result);
      return result;
    } catch (error: any) {
      logger.error("Error fetching supported ERPs", { error: error.message });
      throw new AppError(500, "Failed to fetch supported ERPs");
    }
  }

  /**
   * Add a new ERP configuration
   */
  async addSupportedERP(
    erpConfig: Omit<IERPConfiguration, "createdAt" | "updatedAt">,
    updatedBy: string = "admin",
  ): Promise<IERPConfiguration> {
    try {
      if (!erpConfig.type || !erpConfig.name) {
        throw new ValidationError("ERP type and name are required");
      }

      this.configCache.delete(SystemConfigKey.SUPPORTED_ERPS);

      const existingERPs = await this.getSupportedERPs();

      const exists = existingERPs.find(
        (erp) => erp.type.toLowerCase() === erpConfig.type.toLowerCase(),
      );
      if (exists) {
        throw new ConflictError(`ERP type '${erpConfig.type}' already exists`);
      }

      const newERP: IERPConfiguration = {
        ...erpConfig,
        isActive: erpConfig.isActive ?? true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      existingERPs.push(newERP);

      await this.configRepo.upsert(
        SystemConfigKey.SUPPORTED_ERPS,
        existingERPs,
        {
          description: "List of supported ERP systems",
          updatedBy,
        },
      );

      this.configCache.set(SystemConfigKey.SUPPORTED_ERPS, existingERPs);

      await this.createAuditLog({
        tenantId: "system",
        eventType: AuditEventType.SYSTEM_WARNING,
        severity: AuditEventSeverity.INFO,
        actorType: "user",
        actorId: updatedBy,
        actorName: updatedBy,
        resourceType: "erp_config",
        resourceId: erpConfig.type,
        resourceName: erpConfig.name,
        description: `Supported ERP added: ${erpConfig.name} (${erpConfig.type})`,
        metadata: {
          erpType: erpConfig.type,
          payload: erpConfig,
        },
      });

      logger.info("ERP configuration added", {
        erpType: erpConfig.type,
        updatedBy,
      });

      return newERP;
    } catch (error: any) {
      logger.error("Error adding ERP configuration", { error: error.message });
      if (error instanceof ValidationError || error instanceof ConflictError)
        throw error;
      throw new AppError(500, "Failed to add ERP configuration");
    }
  }

  /**
   * Update an existing ERP configuration
   */
  async updateSupportedERP(
    erpType: string,
    updates: Partial<IERPConfiguration>,
    updatedBy: string = "admin",
  ): Promise<IERPConfiguration> {
    try {
      this.configCache.delete(SystemConfigKey.SUPPORTED_ERPS);

      const existingERPs = await this.getSupportedERPs();

      const index = existingERPs.findIndex(
        (erp) => erp.type.toLowerCase() === erpType.toLowerCase(),
      );

      if (index === -1) {
        throw new NotFoundError(`ERP type '${erpType}' not found`);
      }

      existingERPs[index] = {
        ...existingERPs[index],
        ...updates,
        type: existingERPs[index].type,
        updatedAt: new Date(),
      };

      await this.configRepo.upsert(
        SystemConfigKey.SUPPORTED_ERPS,
        existingERPs,
        {
          description: "List of supported ERP systems",
          updatedBy,
        },
      );

      this.configCache.set(SystemConfigKey.SUPPORTED_ERPS, existingERPs);

      await this.createAuditLog({
        tenantId: "system",
        eventType: AuditEventType.SYSTEM_WARNING,
        severity: AuditEventSeverity.INFO,
        actorType: "user",
        actorId: updatedBy,
        actorName: updatedBy,
        resourceType: "erp_config",
        resourceId: erpType,
        resourceName: existingERPs[index].name,
        description: `Supported ERP updated: ${erpType}`,
        metadata: {
          erpType,
          payload: updates,
        },
      });

      logger.info("ERP configuration updated", { erpType, updatedBy });

      return existingERPs[index];
    } catch (error: any) {
      logger.error("Error updating ERP configuration", {
        error: error.message,
      });
      if (error instanceof NotFoundError) throw error;
      throw new AppError(500, "Failed to update ERP configuration");
    }
  }

  /**
   * Remove an ERP configuration
   */
  async removeSupportedERP(
    erpType: string,
    updatedBy: string = "admin",
  ): Promise<boolean> {
    try {
      this.configCache.delete(SystemConfigKey.SUPPORTED_ERPS);

      const existingERPs = await this.getSupportedERPs();

      const index = existingERPs.findIndex(
        (erp) => erp.type.toLowerCase() === erpType.toLowerCase(),
      );

      if (index === -1) {
        throw new NotFoundError(`ERP type '${erpType}' not found`);
      }

      const removed = existingERPs[index];
      existingERPs.splice(index, 1);

      await this.configRepo.upsert(
        SystemConfigKey.SUPPORTED_ERPS,
        existingERPs,
        {
          description: "List of supported ERP systems",
          updatedBy,
        },
      );

      this.configCache.set(SystemConfigKey.SUPPORTED_ERPS, existingERPs);

      await this.createAuditLog({
        tenantId: "system",
        eventType: AuditEventType.SYSTEM_WARNING,
        severity: AuditEventSeverity.WARNING,
        actorType: "user",
        actorId: updatedBy,
        actorName: updatedBy,
        resourceType: "erp_config",
        resourceId: erpType,
        resourceName: removed.name,
        description: `Supported ERP removed: ${erpType}`,
        metadata: {
          erpType,
          payload: { erpType },
        },
      });

      logger.info("ERP configuration removed", { erpType, updatedBy });

      return true;
    } catch (error: any) {
      logger.error("Error removing ERP configuration", {
        error: error.message,
      });
      if (error instanceof NotFoundError) throw error;
      throw new AppError(500, "Failed to remove ERP configuration");
    }
  }

  /**
   * Get a specific ERP configuration
   */
  async getERPByType(
    erpType: string,
  ): Promise<Partial<InvoiceSchemaDictionaryDocument> | null> {
    try {
      const erp = await this.transformService.getInvoiceSchema(erpType);
      return erp || null;
    } catch (error: any) {
      logger.error("Error fetching ERP configuration", {
        error: error.message,
      });
      throw new AppError(500, "Failed to fetch ERP configuration");
    }
  }

  // ==================== Sandbox Testing ====================

  /**
   * Test invoice transformation in sandbox
   */
  async testTransform(
    erpType: string,
    sampleInvoice: Record<string, any>,
  ): Promise<{
    success: boolean;
    original: any;
    transformed: any;
    errors?: string[];
  }> {
    try {
      const erpConfig = await this.getERPByType(erpType);
      if (!erpConfig) {
        throw new NotFoundError(`ERP type '${erpType}' not configured`);
      }

      const tempAuthContext: AuthContext = {
        tenantId: "SANDBOX",
        businessId: "a6de8bd8-43be-47b9-80a5-988ee3fb9cea",
        serviceId: "34A843BE",
        businessName: "Sandbox Corp",
        isAdmin: false,
      };
      let irn = generateIRN(generateRandomString(5), tempAuthContext.serviceId);
      sampleInvoice.irn = irn;

      const result = await this.transformService.transformInvoice(
        sampleInvoice,
        tempAuthContext,
        erpType as any,
      );

      return {
        success: true,
        original: sampleInvoice,
        transformed: result,
      };
    } catch (error: any) {
      logger.error("Test transform failed", { erpType, error: error.message });
      return {
        success: false,
        original: sampleInvoice,
        transformed: null,
        errors: [error.message],
      };
    }
  }

  /**
   * Test invoice validation in sandbox
   */
  async testValidate(invoice: Record<string, any>): Promise<{
    success: boolean;
    valid: boolean;
    errors?: string[];
    warnings?: string[];
  }> {
    try {
      const result: any = await this.firsService.validateInvoice(invoice);
      const isValid = result?.data?.ok === true;

      return {
        success: true,
        valid: isValid,
        errors: isValid
          ? undefined
          : result?.data?.errors || ["Validation failed"],
        warnings: [],
      };
    } catch (error: any) {
      logger.error("Test validate failed", { error: error.message });
      return {
        success: false,
        valid: false,
        errors: [error.message],
      };
    }
  }

  /**
   * Full transform and validate test
   */
  async testTransformAndValidate(
    erpType: string,
    sampleInvoice: Record<string, any>,
  ): Promise<{
    success: boolean;
    original: any;
    transformed: any;
    validation: {
      valid: boolean;
      errors?: string[];
    };
  }> {
    try {
      const transformResult = await this.testTransform(erpType, sampleInvoice);

      if (!transformResult.success || !transformResult.transformed) {
        return {
          success: false,
          original: sampleInvoice,
          transformed: null,
          validation: {
            valid: false,
            errors: transformResult.errors || ["Transform failed"],
          },
        };
      }

      const validateResult = await this.testValidate(
        transformResult.transformed,
      );

      return {
        success: true,
        original: sampleInvoice,
        transformed: transformResult.transformed,
        validation: {
          valid: validateResult.valid,
          errors: validateResult.errors,
        },
      };
    } catch (error: any) {
      logger.error("Test transform and validate failed", {
        erpType,
        error: error.message,
      });
      return {
        success: false,
        original: sampleInvoice,
        transformed: null,
        validation: {
          valid: false,
          errors: [error.message],
        },
      };
    }
  }
}
