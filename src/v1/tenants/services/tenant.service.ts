/**
 * Tenant Service
 * Business logic for tenant lifecycle management
 */

import { TenantRepository } from '../repos/tenant.repo';
import { ApiKeyRepository } from '../repos/api-key.repo';
import { TenantOnboardingRepository } from '../repos/tenant-onboarding.repo';
import { AuditLogRepository } from '../../audit/repos/audit-log.repo';
import { encryptSensitiveData, decryptSensitiveData } from '../../../@lib/crypto';
import { hashString, generateRandomString } from '../../../@lib/utils/encryption';
import { AppError, NotFoundError, ValidationError, ConflictError } from '../../../@lib/errors';
import { type TenantDocument, TenantStatus, OnboardingStatus, ApiKeyDocument, ApiKeyStatus, TenantOnboardingDocument } from '../models';
import { appConfig } from '../../../@config';
import { AuditEventSeverity, AuditEventType } from '../../audit/models';
import { MailContent, NodeMailerClient } from '../../../@lib/messaging';
import { SchemaSourceType } from '../../workflow/models';

export interface CreateTenantInput {
  businessName: string;
  tin: string;
  businessRegistrationNumber: string;
  contactEmail: string;
  contactPhone: string;
  erpSystem: SchemaSourceType;
  expectedVolume?: number;
  erpWebhookUrl?: string;
  erpApiKey?: string;
  webhookUrl?: string;
}

export interface UpdateTenantInput {
  businessName?: string;
  contactEmail?: string;
  password?: string;
  erpSystem?: SchemaSourceType;
  contactPhone?: string;
  erpWebhookUrl?: string;
  erpApiKey?: string;
  webhookUrl?: string;
  webhookEnabled?: boolean;
  features?: {
    autoFix?: boolean;
    maxRetries?: number;
    qrCodeGeneration?: boolean;
  };
  limits?: {
    monthlyInvoiceLimit?: number;
    apiRateLimit?: number;
  };
}

export interface FIRSCredentialsInput {
  clientId?: string;
  serviceId?: string;
  certificate?: string;
  publicKey?: string;
}

export interface CreateApiKeyInput {
  name: string;
  scopes?: string[];
  expiresInDays?: number;
}

export interface UpdateOnboardingInput {
  status?: 'pending' | 'in_progress' | 'testing' | 'active' | 'rejected';
  notes?: string;
  rejectionReason?: string;
}

export interface ERPSyncConfigInput {
  name: string;
  description?: string;
  enabled: boolean;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  baseUrl: string;
  endpoint: string;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  bodyTemplate?: string;
  authentication?: {
    type: 'none' | 'basic' | 'bearer' | 'api-key' | 'oauth2';
    username?: string;
    password?: string;
    token?: string;
    apiKeyName?: string;
    apiKeyValue?: string;
    apiKeyLocation?: 'header' | 'query';
  };
  timeout?: number;
  retryConfig?: {
    maxRetries: number;
    retryDelay: number;
    retryOn?: number[];
  };
  responseMapping?: Record<string, string>;
  triggerEvents?: string[];
}

export class TenantService {
  private tenantRepo: TenantRepository;
  private apiKeyRepo: ApiKeyRepository;
  private onboardingRepo: TenantOnboardingRepository;
  private auditRepo: AuditLogRepository;

  constructor() {
    this.tenantRepo = new TenantRepository();
    this.apiKeyRepo = new ApiKeyRepository();
    this.onboardingRepo = new TenantOnboardingRepository();
    this.auditRepo = new AuditLogRepository();
  }
  /* 
   *Notify Tenant 
  */
  async notifyTenant(mail: MailContent, tenant: TenantDocument): Promise<any> {
    // Send customer email to activate their account.
    let mailClient = new NodeMailerClient();
    let mailContent: MailContent = {
      to: tenant.contactEmail as string,
      subject: mail.subject,
      html: (mail.html || mail.text) as string,
    };
    mailClient.send(mailContent);
  }

  /**
   * Create a new tenant
   */
  async createTenant(input: CreateTenantInput): Promise<TenantDocument> {
    // Check if TIN already exists
    const existingTenant = await this.tenantRepo.findByTIN(input.tin);
    if (existingTenant) {
      throw new ConflictError('Tenant with this TIN already exists');
    }

    // Generate business ID
    const tenantId = this.generateBusinessId(input.businessName, input.tin);

    // Create tenant
    const tenant = await this.tenantRepo.create({
      tenantId,
      businessName: input.businessName,
      tin: input.tin,
      businessRegistrationNumber: input.businessRegistrationNumber,
      contactEmail: input.contactEmail,
      contactPhone: input.contactPhone,
      expectedVolume: input.expectedVolume,
      status: TenantStatus.ONBOARDING,
      config: { erpSystem: input.erpSystem, }
    });

    // Create onboarding record
    await this.onboardingRepo.create({
      tenantId: tenant.tenantId,
      status: OnboardingStatus.IN_PROGRESS,
      steps: {
        registration: { completed: true, completedAt: new Date() },
        firsProvisioning: { completed: false },
        erpConfiguration: { completed: false },
        testing: { completed: false },
        goLive: { completed: false },
      },
      createdBy: 'system',
    });

    // Audit log
    await this.auditRepo.create({
      tenantId: tenant.tenantId,
      eventId: `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      eventType: AuditEventType.TENANT_CREATED,
      description: `Tenant ${tenant.businessName} created`,
      severity: AuditEventSeverity.INFO,
      actor: {
        actorType: 'system',
        actorId: 'system',
        actorName: 'System',
      },
      resource: {
        resourceType: 'tenant',
        resourceId: tenant.tenantId,
        resourceName: tenant.businessName,
      },
      metadata: {
        businessName: input.businessName,
        tin: input.tin,
      },
      timestamp: new Date(),
    });

    return tenant;
  }

  /**
   * Get tenant by email or tin
   */
  async getTenantByTin(tin: string): Promise<TenantDocument> {
    const tenant = await this.tenantRepo.findOne({ tin: { _eq: tin } });
    if (!tenant) {
      throw new NotFoundError('Tenant');
    }
    return tenant;
  }

  /**
   * Get tenant by ID
   */
  async getTenantById(tenantId: string): Promise<TenantDocument> {
    const tenant = await this.tenantRepo.findOne({ tenantId: { _eq: tenantId } });
    if (!tenant) {
      throw new NotFoundError('Tenant');
    }
    return tenant;
  }

  /**
   * Get tenant by business ID
   */
  async getTenantByBusinessId(businessId: string): Promise<TenantDocument> {
    const tenant = await this.tenantRepo.findByBusinessId(businessId);
    if (!tenant) {
      throw new NotFoundError('Tenant');
    }
    return tenant;
  }

  /**
   * List tenants with pagination
   */
  async listTenants(filters?: {
    status?: string;
    erpSystem?: string;
    skip?: number;
    limit?: number;
  }): Promise<{ tenants: TenantDocument[]; total: number }> {
    const skip = filters?.skip || 0;
    const limit = filters?.limit || 20;

    const query: any = {};
    if (filters?.status) query.status._eq = filters.status;
    if (filters?.erpSystem) query.erpSystem._eq = filters.erpSystem;

    const tenants = await this.tenantRepo.findMany(query, skip, limit);
    const total = await this.tenantRepo.count(query);

    return { tenants, total };
  }

  /**
   * Update tenant
   */
  async updateTenant(tenantId: string, input: UpdateTenantInput): Promise<TenantDocument> {
    const tenant = await this.getTenantById(tenantId);

    const updateData: any = {};

    if (input.password) updateData.password = input.password;
    if (input.businessName) updateData.businessName = input.businessName;
    if (input.contactEmail) updateData.contactEmail = input.contactEmail;
    if (input.contactPhone) updateData.contactPhone = input.contactPhone;
    if (input.erpWebhookUrl) updateData.erpWebhookUrl = input.erpWebhookUrl;
    if (input.webhookUrl) updateData.webhookUrl = input.webhookUrl;
    if (input.webhookEnabled !== undefined) updateData.webhookEnabled = input.webhookEnabled;

    // Encrypt ERP API key if provided
    if (input.erpApiKey) {
      updateData.erpApiKey = encryptSensitiveData(input.erpApiKey, appConfig?.adminKey);
    }

    // Update features
    if (input.features) {
      updateData['config.features'] = {
        ...tenant?.config?.features,
        ...input.features,
      };
    }

    // Update limits
    if (input.limits) {
      updateData['config.limits'] = {
        ...(tenant?.config?.limits || {}),
        ...(input?.limits || {}),
      };
    }

    // Update Tenant ERP 
    if (input.erpSystem) {
      updateData['config.erpSystem'] = input.erpSystem
    }

    console.log({ updateData })

    const updatedTenant = await this.tenantRepo.update(tenantId, updateData);

    // Audit log
    await this.auditRepo.create({
      tenantId: tenant.tenantId,
      eventId: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      eventType: AuditEventType.TENANT_UPDATED,
      severity: 'info' as any,
      actor: { actorType: 'system', actorId: 'system' },
      resource: { resourceType: 'tenant', resourceId: tenant.tenantId },
      description: 'Tenant updated',
      metadata: updateData,
      timestamp: new Date(),
    });

    return updatedTenant!;
  }

  /**
   * Activate tenant
   */
  async activateTenant(tenantId: string): Promise<TenantDocument> {
    const tenant = await this.getTenantById(tenantId);

    if (tenant.status === 'active') {
      throw new ValidationError('Tenant is already active');
    }

    const updatedTenant = await this.tenantRepo.activate(tenantId);

    // Audit log
    await this.auditRepo.create({
      tenantId: tenant.tenantId,
      eventId: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      eventType: AuditEventType.TENANT_ACTIVATED,
      severity: 'info' as any,
      actor: { actorType: 'system', actorId: 'system' },
      resource: { resourceType: 'tenant', resourceId: tenant.tenantId },
      description: 'Tenant activated',
      metadata: {},
      timestamp: new Date(),
    });

    return updatedTenant!;
  }

  /**
   * Suspend tenant
   */
  async suspendTenant(tenantId: string, reason?: string): Promise<TenantDocument> {
    const tenant = await this.getTenantById(tenantId);

    if (tenant.status === 'suspended') {
      throw new ValidationError('Tenant is already suspended');
    }

    const updatedTenant = await this.tenantRepo.suspend(tenantId);

    // Audit log
    await this.auditRepo.create({
      tenantId: tenant.tenantId,
      eventId: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      eventType: AuditEventType.TENANT_SUSPENDED,
      severity: AuditEventSeverity.WARNING,
      actor: { actorType: 'system', actorId: 'system' },
      resource: { resourceType: 'tenant', resourceId: tenant.tenantId },
      description: `Tenant suspended${reason ? `: ${reason}` : ''}`,
      metadata: { reason },
      timestamp: new Date(),
    });

    return updatedTenant!;
  }

  /**
   * Delete tenant (soft delete)
   */
  async deleteTenant(tenantId: string): Promise<void> {
    const tenant = await this.getTenantById(tenantId);

    // Check if tenant has active invoices
    // This would require checking invoice counts - implement based on requirements

    await this.tenantRepo.delete(tenantId);

    // Audit log
    await this.auditRepo.create({
      tenantId: tenant.tenantId,
      eventId: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      eventType: AuditEventType.TENANT_DELETED,
      severity: 'warning' as any,
      actor: { actorType: 'system', actorId: 'system' },
      resource: { resourceType: 'tenant', resourceId: tenant.tenantId },
      description: 'Tenant deleted',
      metadata: {},
      timestamp: new Date(),
    });
  }

  /**
   * Update FIRS credentials
   */
  async updateFIRSCredentials(
    tenantId: string,
    credentials: FIRSCredentialsInput
  ): Promise<TenantDocument> {
    const tenant = await this.getTenantById(tenantId);
    let updateData: any = {
      serviceId: credentials.serviceId
    }
    // Encrypt sensitive credentials
    if (credentials.certificate && credentials.publicKey) {
      const encryptedCertificate = encryptSensitiveData(
        credentials.certificate
      );
      const encryptedPublicKey = encryptSensitiveData(
        credentials.publicKey
      );

      updateData = {
        ...updateData,
        'certificate': encryptedCertificate,
        'publicKey': encryptedPublicKey,
      };
    }

    if (credentials.clientId) {
      updateData['clientId'] = encryptSensitiveData(
        credentials.clientId
      );
    }
    console.log({ updateData })
    const updatedTenant = await this.tenantRepo.updateFIRSCredentials(tenantId, updateData);

    // Audit log
    await this.auditRepo.create({
      tenantId: tenant.tenantId,
      eventId: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      eventType: AuditEventType.TENANT_UPDATED,
      severity: AuditEventSeverity.INFO,
      actor: { actorType: 'system', actorId: 'system' },
      resource: { resourceType: 'tenant', resourceId: tenant.tenantId },

      description: 'FIRS credentials updated',
      metadata: {},
      timestamp: new Date(),
    });

    return updatedTenant!;
  }

  /**
   * Get decrypted FIRS credentials
   */
  async getFIRSCredentials(tenantId: string): Promise<{
    certificate: string;
    publicKey: string;
    clientId?: string;
  }> {
    const tenant = await this.getTenantById(tenantId);

    if (!tenant.config?.firsCredentials?.certificate) {
      throw new NotFoundError('FIRS credentials not configured');
    }

    const certificate = decryptSensitiveData(
      tenant.config.firsCredentials.certificate
    );
    const publicKey = decryptSensitiveData(
      tenant.config.firsCredentials.publicKey!
    );
 

    const result: any = {
      certificate,
      publicKey,
      /*   privateKey, */
    };

    if (tenant.config.firsCredentials.clientId) {
      result.clientId = decryptSensitiveData(
        tenant.config.firsCredentials.clientId 
      );
    }

    return result;
  }

  /**
   * Create API key for tenant
   */
  async createApiKey(
    tenantId: string,
    input: CreateApiKeyInput
  ): Promise<{ apiKey: ApiKeyDocument; plainKey: string }> {
    const tenant = await this.getTenantById(tenantId);

    // Generate API key
    const plainKey = this.generateApiKey();
    const keyHash = hashString(plainKey);
    const keyPrefix = plainKey.substring(0, 8);

    // Calculate expiry
    const expiresAt = input.expiresInDays
      ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
      : undefined;

    // Create API key record
    const apiKey = await this.apiKeyRepo.create({
      tenantId: tenant.tenantId,
      name: input.name,
      keyHash,
      keyPrefix,
      scopes: input.scopes || [],
      expiresAt,
      status: ApiKeyStatus.ACTIVE,
    });

    // Audit log
    await this.auditRepo.create({
      tenantId: tenant.tenantId,
      eventId: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      eventType: AuditEventType.API_KEY_CREATED,
      severity: AuditEventSeverity.INFO,
      actor: { actorType: 'system', actorId: 'system' },
      resource: { resourceType: 'api_key', resourceId: apiKey._id.toString() },
      description: `API key created: ${input.name}`,
      metadata: { name: input.name, keyPrefix },
      timestamp: new Date(),
    });

    return { apiKey, plainKey };
  }

  /**
   * List API keys for tenant
   */
  async listApiKeys(tenantId: string): Promise<{ data: ApiKeyDocument[]; meta: any }> {
    const tenant = await this.getTenantById(tenantId);
    return this.apiKeyRepo.findByTenantId(tenantId);
  }

  /**
   * Revoke API key
   */
  async revokeApiKey(tenantId: string, keyId: string, reason?: string): Promise<void> {
    const tenant = await this.getTenantById(tenantId);
    const apiKey = await this.apiKeyRepo.findOne({ id: { _eq: keyId } });

    if (!apiKey || apiKey.tenantId !== tenant.tenantId) {
      throw new NotFoundError('API key');
    }

    await this.apiKeyRepo.revoke(keyId, "system", reason!);

    // Audit log
    await this.auditRepo.create({
      tenantId: tenant.tenantId,
      eventId: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      eventType: AuditEventType.API_KEY_REVOKED,
      severity: 'warning' as any,
      actor: { actorType: 'system', actorId: 'system' },
      resource: { resourceType: 'api_key', resourceId: keyId },
      description: `API key revoked${reason ? `: ${reason}` : ''}`,
      metadata: { reason },
      timestamp: new Date(),
    });
  }

  /**
   * Get onboarding status
   */
  async getOnboardingStatus(tenantId: string): Promise<TenantOnboardingDocument> {
    const tenant = await this.getTenantById(tenantId);
    const onboarding = await this.onboardingRepo.findByTenantId(tenant.tenantId);

    if (!onboarding) {
      throw new NotFoundError('Onboarding record');
    }

    return onboarding;
  }

  /**
   * Complete an onboarding step
   */
  async completeOnboardingStep(
    tenantId: string,
    step: 'registration' | 'firsProvisioning' | 'erpConfiguration' | 'testing' | 'goLive'
  ): Promise<TenantOnboardingDocument> {
    const tenant = await this.getTenantById(tenantId);

    const updated = await this.onboardingRepo.completeStep(tenant.tenantId, step);

    // Audit log
    await this.auditRepo.create({
      tenantId: tenant.tenantId,
      eventId: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      eventType: AuditEventType.TENANT_UPDATED,
      severity: AuditEventSeverity.INFO,
      actor: { actorType: 'system', actorId: 'system' },
      resource: { resourceType: 'onboarding', resourceId: updated.tenantId },
      action: 'onboarding.step_completed',
      description: `Onboarding step completed: ${step}`,
      metadata: { step },
      timestamp: new Date(),
    } as any);

    return updated;
  }

  /**
   * Update onboarding status
   */
  async updateOnboarding(
    tenantId: string,
    input: UpdateOnboardingInput
  ): Promise<TenantOnboardingDocument> {
    const tenant = await this.getTenantById(tenantId);
    const onboarding = await this.onboardingRepo.findByTenantId(tenant.tenantId);

    if (!onboarding) {
      throw new NotFoundError('Onboarding record');
    }

    const updateData: any = {};

    if (input.status) updateData.status = input.status;
    if (input.notes) updateData.notes = input.notes;
    if (input.rejectionReason) updateData.rejectionReason = input.rejectionReason;

    const updated = await this.onboardingRepo.update(tenant.tenantId, updateData);

    // Audit log
    await this.auditRepo.create({
      tenantId: tenant.tenantId,
      eventId: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      eventType: AuditEventType.TENANT_UPDATED,
      severity: AuditEventSeverity.INFO,
      actor: { actorType: 'system', actorId: 'system' },
      resource: { resourceType: 'onboarding', resourceId: onboarding._id.toString() },
      action: 'onboarding.status_updated',
      description: 'Tenant onboarding status updated',
      metadata: updateData,
      timestamp: new Date(),
    } as any);

    return updated!;
  }

  /**
   * Approve onboarding
   */
  async approveOnboarding(tenantId: string): Promise<void> {
    const tenant = await this.getTenantById(tenantId);
    const onboarding = await this.onboardingRepo.findByTenantId(tenant.tenantId);

    if (!onboarding) {
      throw new NotFoundError('Onboarding record');
    }

    await this.onboardingRepo.approve(tenantId, "system");
    await this.activateTenant(tenantId);

    // Audit log
    await this.auditRepo.create({
      tenantId,
      eventId: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      eventType: AuditEventType.TENANT_ACTIVATED,
      severity: 'info' as any,
      actor: { actorType: 'system', actorId: 'system' },
      resource: { resourceType: 'onboarding', resourceId: onboarding._id.toString() },
      description: 'Tenant onboarding approved',
      metadata: {},
      timestamp: new Date(),
    });
  }

  /**
   * Reject onboarding
   */
  async rejectOnboarding(tenantId: string, reason: string): Promise<void> {
    const tenant = await this.getTenantById(tenantId);
    const onboarding = await this.onboardingRepo.findByTenantId(tenant.tenantId);

    if (!onboarding) {
      throw new NotFoundError('Onboarding record');
    }

    await this.onboardingRepo.reject(onboarding._id.toString(), reason);

    // Audit log
    await this.auditRepo.create({
      tenantId,
      eventId: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      eventType: AuditEventType.TENANT_UPDATED,
      severity: 'warning' as any,
      actor: { actorType: 'system', actorId: 'system' },
      resource: { resourceType: 'onboarding', resourceId: onboarding._id.toString() },
      description: `Tenant onboarding rejected: ${reason}`,
      metadata: { reason },
      timestamp: new Date(),
    });
  }

  /**
   * Configure ERP sync settings
   */
  async configureERPSync(
    tenantId: string,
    config: ERPSyncConfigInput
  ): Promise<TenantDocument> {
    const tenant = await this.getTenantById(tenantId);

    // Encrypt sensitive authentication data
    const encryptedConfig: any = { ...config };

    if (config.authentication) {
      if (config.authentication.password) {
        encryptedConfig.authentication.password = encryptSensitiveData(
          config.authentication.password,
          appConfig?.adminKey
        );
      }
      if (config.authentication.token) {
        encryptedConfig.authentication.token = encryptSensitiveData(
          config.authentication.token,
          appConfig?.adminKey
        );
      }
      if (config.authentication.apiKeyValue) {
        encryptedConfig.authentication.apiKeyValue = encryptSensitiveData(
          config.authentication.apiKeyValue,
          appConfig?.adminKey
        );
      }
    }

    // Update tenant with ERP sync configuration
    const updateData: any = {
      'config.erpSyncConfig': encryptedConfig,
    };

    const updatedTenant = await this.tenantRepo.update(tenantId, updateData);

    // Audit log
    await this.auditRepo.create({
      tenantId: tenant.tenantId,
      eventId: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      eventType: AuditEventType.TENANT_UPDATED,
      severity: AuditEventSeverity.INFO,
      actor: { actorType: 'system', actorId: 'system' },
      resource: { resourceType: 'tenant', resourceId: tenant.tenantId },
      action: 'tenant.erp_sync_configured',
      description: `ERP sync configuration updated: ${config.name}`,
      metadata: {
        configName: config.name,
        method: config.method,
        endpoint: config.endpoint,
        enabled: config.enabled,
      },
      timestamp: new Date(),
    } as any);

    return updatedTenant!;
  }

  /**
   * Get ERP sync configuration with decrypted credentials
   */
  async getERPSyncConfig(tenantId: string): Promise<ERPSyncConfigInput | null> {
    const tenant = await this.getTenantById(tenantId);

    const config = (tenant as any).config?.erpSyncConfig;
    if (!config) {
      return null;
    }

    // Decrypt sensitive data
    const decryptedConfig = { ...config };

    if (config.authentication) {
      if (config.authentication.password) {
        decryptedConfig.authentication.password = decryptSensitiveData(
          config.authentication.password,
          appConfig?.adminKey
        );
      }
      if (config.authentication.token) {
        decryptedConfig.authentication.token = decryptSensitiveData(
          config.authentication.token,
          appConfig?.adminKey
        );
      }
      if (config.authentication.apiKeyValue) {
        decryptedConfig.authentication.apiKeyValue = decryptSensitiveData(
          config.authentication.apiKeyValue,
          appConfig?.adminKey
        );
      }
    }

    return decryptedConfig;
  }

  /**
   * Private: Generate business ID
   */
  private generateBusinessId(businessName: string, tin: string): string {
    const prefix = businessName
      .substring(0, 3)
      .toUpperCase()
      .replace(/[^A-Z]/g, '');
    const tinSuffix = tin.substring(tin.length - 4);
    const random = generateRandomString(4).substring(0, 4).toUpperCase();
    return `${prefix}-${tinSuffix}-${random}`;
  }

  /**
   * Private: Generate API key
   */
  private generateApiKey(): string {
    return `sk_${generateRandomString(32)}`;
  }
}
