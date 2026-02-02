import { generateRandomString, logger } from '../../../@lib';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../../../@lib/errors';
import { SystemConfigRepository } from '../repos/system-config.repo';
import { SystemConfigKey, IERPConfiguration } from '../models/system-config.model';
import { TransformWorkflowService } from '../../workflow/services/workflows/transform.service';
import { FIRSService } from '../../../@lib/adapters/firs/firs.service';
import { AuthContext } from '../../../middlewares';
import { InvoiceSchemaDictionaryDocument } from '../../workflow/models';
import { generateIRN } from '../../workflow/utils/transformer/utils';

export class SystemConfigService {
  private configRepo: SystemConfigRepository;
  private transformService: TransformWorkflowService;
  private firsService: FIRSService;

  constructor() {
    this.configRepo = new SystemConfigRepository();
    this.transformService = new TransformWorkflowService();
    this.firsService = new FIRSService();
  }

  // ==================== FIRS Dictionary Management ====================

  /**
   * Get FIRS Dictionary Schema
   */
  async getFIRSDictionary(): Promise<any> {
    try {
      const config = await this.configRepo.getByKey(SystemConfigKey.FIRS_DICTIONARY);

      if (!config) {
        return {
          schema: null,
          version: 0,
          message: 'FIRS dictionary not configured',
        };
      }

      return {
        schema: config.configValue,
        version: config.version,
        updatedAt: config.updatedAt,
        updatedBy: config.updatedBy,
      };
    } catch (error: any) {
      logger.error('Error fetching FIRS dictionary', { error: error.message });
      throw new AppError(500, 'Failed to fetch FIRS dictionary');
    }
  }

  /**
   * Update FIRS Dictionary Schema
   */
  async updateFIRSDictionary(
    schema: Record<string, any>,
    updatedBy: string = 'admin'
  ): Promise<any> {
    try {
      // Validate schema structure
      if (!schema || typeof schema !== 'object') {
        throw new ValidationError('Invalid schema format');
      }

      const config = await this.configRepo.upsert(
        SystemConfigKey.FIRS_DICTIONARY,
        schema,
        {
          description: 'FIRS UBL Invoice Schema Dictionary',
          updatedBy,
        }
      );

      logger.info('FIRS dictionary updated', { version: config.version, updatedBy });

      return {
        success: true,
        schema: config.configValue,
        version: config.version,
        updatedAt: config.updatedAt,
      };
    } catch (error: any) {
      logger.error('Error updating FIRS dictionary', { error: error.message });
      if (error instanceof ValidationError) throw error;
      throw new AppError(500, 'Failed to update FIRS dictionary');
    }
  }

  // ==================== ERP Configuration Management ====================

  /**
   * Get all supported ERPs
   */
  async getSupportedERPs(): Promise<IERPConfiguration[]> {
    try {
      const config = await this.configRepo.getByKey(SystemConfigKey.SUPPORTED_ERPS);

      if (!config) {
        return [];
      }

      return config.configValue as IERPConfiguration[];
    } catch (error: any) {
      logger.error('Error fetching supported ERPs', { error: error.message });
      throw new AppError(500, 'Failed to fetch supported ERPs');
    }
  }

  /**
   * Add a new ERP configuration
   */
  async addSupportedERP(
    erpConfig: Omit<IERPConfiguration, 'createdAt' | 'updatedAt'>,
    updatedBy: string = 'admin'
  ): Promise<IERPConfiguration> {
    try {
      // Validate required fields
      if (!erpConfig.type || !erpConfig.name) {
        throw new ValidationError('ERP type and name are required');
      }

      // Get existing ERPs
      const existingERPs = await this.getSupportedERPs();

      // Check if ERP type already exists
      const exists = existingERPs.find(
        (erp) => erp.type.toLowerCase() === erpConfig.type.toLowerCase()
      );
      if (exists) {
        throw new ConflictError(`ERP type '${erpConfig.type}' already exists`);
      }

      // Create new ERP entry
      const newERP: IERPConfiguration = {
        ...erpConfig,
        isActive: erpConfig.isActive ?? true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Add to list and save
      existingERPs.push(newERP);

      await this.configRepo.upsert(
        SystemConfigKey.SUPPORTED_ERPS,
        existingERPs,
        {
          description: 'List of supported ERP systems',
          updatedBy,
        }
      );

      logger.info('ERP configuration added', { erpType: erpConfig.type, updatedBy });

      return newERP;
    } catch (error: any) {
      logger.error('Error adding ERP configuration', { error: error.message });
      if (error instanceof ValidationError || error instanceof ConflictError) throw error;
      throw new AppError(500, 'Failed to add ERP configuration');
    }
  }

  /**
   * Update an existing ERP configuration
   */
  async updateSupportedERP(
    erpType: string,
    updates: Partial<IERPConfiguration>,
    updatedBy: string = 'admin'
  ): Promise<IERPConfiguration> {
    try {
      const existingERPs = await this.getSupportedERPs();

      const index = existingERPs.findIndex(
        (erp) => erp.type.toLowerCase() === erpType.toLowerCase()
      );

      if (index === -1) {
        throw new NotFoundError(`ERP type '${erpType}' not found`);
      }

      // Update ERP configuration
      existingERPs[index] = {
        ...existingERPs[index],
        ...updates,
        type: existingERPs[index].type, // Don't allow type change
        updatedAt: new Date(),
      };

      await this.configRepo.upsert(
        SystemConfigKey.SUPPORTED_ERPS,
        existingERPs,
        {
          description: 'List of supported ERP systems',
          updatedBy,
        }
      );

      logger.info('ERP configuration updated', { erpType, updatedBy });

      return existingERPs[index];
    } catch (error: any) {
      logger.error('Error updating ERP configuration', { error: error.message });
      if (error instanceof NotFoundError) throw error;
      throw new AppError(500, 'Failed to update ERP configuration');
    }
  }

  /**
   * Remove an ERP configuration
   */
  async removeSupportedERP(erpType: string, updatedBy: string = 'admin'): Promise<boolean> {
    try {
      const existingERPs = await this.getSupportedERPs();

      const index = existingERPs.findIndex(
        (erp) => erp.type.toLowerCase() === erpType.toLowerCase()
      );

      if (index === -1) {
        throw new NotFoundError(`ERP type '${erpType}' not found`);
      }

      // Remove from list
      existingERPs.splice(index, 1);

      await this.configRepo.upsert(
        SystemConfigKey.SUPPORTED_ERPS,
        existingERPs,
        {
          description: 'List of supported ERP systems',
          updatedBy,
        }
      );

      logger.info('ERP configuration removed', { erpType, updatedBy });

      return true;
    } catch (error: any) {
      logger.error('Error removing ERP configuration', { error: error.message });
      if (error instanceof NotFoundError) throw error;
      throw new AppError(500, 'Failed to remove ERP configuration');
    }
  }

  /**
   * Get a specific ERP configuration
   */
  async getERPByType(erpType: string): Promise<Partial<InvoiceSchemaDictionaryDocument> | null> {
    try {
        const erp = await new TransformWorkflowService().getInvoiceSchema(erpType);


      return erp || null;
    } catch (error: any) {
      logger.error('Error fetching ERP configuration', { error: error.message });
      throw new AppError(500, 'Failed to fetch ERP configuration');
    }
  }

  // ==================== Sandbox Testing ====================

  /**
   * Test invoice transformation in sandbox
   */
  async testTransform(
    erpType: string,
    sampleInvoice: Record<string, any>
  ): Promise<{
    success: boolean;
    original: any;
    transformed: any; 
    errors?: string[];
  }> {
    try {
      // Get ERP schema
      const erpConfig = await this.getERPByType(erpType);
      if (!erpConfig) {
        throw new NotFoundError(`ERP type '${erpType}' not configured`);
      }
 
      // Create tempAuthContext
      const tempAuthContext: AuthContext = {
        tenantId: "SANDBOX",
        businessId:"a6de8bd8-43be-47b9-80a5-988ee3fb9cea",
        serviceId: "34A843BE",
        businessName: "Sandbox Corp",
        isAdmin: false
      }
      let irn = generateIRN(generateRandomString(5),tempAuthContext.serviceId)
      sampleInvoice.irn = irn;
      // Perform transformation using the transform service
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
      logger.error('Test transform failed', { erpType, error: error.message });
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
  async testValidate(
    invoice: Record<string, any>
  ): Promise<{
    success: boolean;
    valid: boolean;
    errors?: string[];
    warnings?: string[];
  }> {
    try {
      // Validate using FIRS service
      const result: any = await this.firsService.validateInvoice(invoice);

      const isValid = result?.data?.ok === true;

      return {
        success: true,
        valid: isValid,
        errors: isValid ? undefined : result?.data?.errors || ['Validation failed'],
        warnings: [],
      };
    } catch (error: any) {
      logger.error('Test validate failed', { error: error.message });
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
    sampleInvoice: Record<string, any>
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
      // First transform
      const transformResult = await this.testTransform(erpType, sampleInvoice);

      if (!transformResult.success || !transformResult.transformed) {
        return {
          success: false,
          original: sampleInvoice,
          transformed: null,
          validation: {
            valid: false,
            errors: transformResult.errors || ['Transform failed'],
          },
        };
      }

      // Then validate
      const validateResult = await this.testValidate(transformResult.transformed);

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
      logger.error('Test transform and validate failed', { erpType, error: error.message });
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
