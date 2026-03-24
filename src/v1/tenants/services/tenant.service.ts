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
import { logger } from '../../../@lib';
import { type TenantDocument, TenantStatus, OnboardingStatus, ApiKeyDocument, ApiKeyStatus, TenantOnboardingDocument } from '../models';
import { appConfig } from '../../../@config';
import { AuditEventSeverity, AuditEventType } from '../../audit/models';
import { MailContent, NodeMailerClient, withTemplate } from '../../../@lib/messaging';
import { SchemaSourceType } from '../../workflow/models';

export interface CreateTenantInput {
  businessName: string;
  tin: string;
  businessRegistrationNumber: string;
  contactEmail: string;
  contactPhone: string;
  erpSystem: SchemaSourceType | string;
  expectedVolume?: number;
  erpWebhookUrl?: string;
  erpApiKey?: string;
  webhookUrl?: string;
}

export interface UpdateTenantInput {
  businessName?: string;
  contactEmail?: string;
  password?: string;
  erpSystem?: SchemaSourceType |string;
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
  metadata?: any;
  config?: any;
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
    await mailClient.send(mailContent);
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
  async getTenantByTinOrEmail(tinOrEmail: string): Promise<TenantDocument> {
    const tenant = await this.tenantRepo.findOne({search: tinOrEmail});
    console.log({tenant})
    if (!tenant) {
      throw new NotFoundError('Tenant');
    }
    return tenant;
  }

  /**
   * Get tenant by ID
   */
  async getTenantById(tenantId: string, includeOnboarding: boolean = false): Promise<TenantDocument & { onboarding?: any }> {
    const tenant = await this.tenantRepo.findOne({ tenantId: { _eq: tenantId } });
    if (!tenant) {
      throw new NotFoundError('Tenant');
    }

    if (includeOnboarding) {
      try {
        const onboarding = await this.onboardingRepo.findByTenantId(tenantId);
        return { ...tenant.toObject(), onboarding } as any;
      } catch (error) {
        // If onboarding not found, return tenant without it
        return tenant;
      }
    }

    return tenant;
  }

  /**
   * Get tenant by Email
   */
  async getTenantByEmail(contactEmail: string, includeOnboarding: boolean = false): Promise<TenantDocument & { onboarding?: any }> {
    const tenant = await this.tenantRepo.findOne({ contactEmail: { _iexact: contactEmail } });
    if (!tenant) {
      throw new NotFoundError('Tenant');
    }

    if (includeOnboarding) {
      try {
        const onboarding = await this.onboardingRepo.findByTenantId(contactEmail);
        return { ...tenant.toObject(), onboarding } as any;
      } catch (error) {
        // If onboarding not found, return tenant without it
        return tenant;
      }
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
    includeOnboarding?: boolean;
  }): Promise<{ tenants: Array<TenantDocument & { onboarding?: any }>; total: number }> {
    const skip = filters?.skip || 0;
    const limit = filters?.limit || 20;

    const query: any = {};
    if (filters?.status) query.status._eq = filters.status;
    if (filters?.erpSystem) query.erpSystem._eq = filters.erpSystem;

    const tenants = await this.tenantRepo.findMany(query, skip, limit);
    const total = await this.tenantRepo.count(query);

    // Include onboarding status if requested
    if (filters?.includeOnboarding) {
      const tenantsWithOnboarding = await Promise.all(
        tenants.map(async (tenant) => {
          try {
            const onboarding = await this.onboardingRepo.findByTenantId(tenant.tenantId);
            return { ...tenant.toObject(), onboarding } as any;
          } catch (error) {
            // If onboarding not found, return tenant without it
            return tenant;
          }
        })
      );
      return { tenants: tenantsWithOnboarding, total };
    }

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
   
    // Update metadata 
    if (input.metadata) {
      updateData['metadata'] = {
        ...tenant.metadata,
        ...input.metadata
      }
    }

    if (input.config) {
      updateData['config'] = {
        ...tenant.config,
        ...input.config
      }
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
   * Rotate API key (revoke old and create new)
   */
  async rotateApiKey(
    tenantId: string,
    keyId: string,
    options?: { sendEmail?: boolean; reason?: string }
  ): Promise<{ apiKey: ApiKeyDocument; plainKey: string }> {
    const tenant = await this.getTenantById(tenantId);
    const oldApiKey = await this.apiKeyRepo.findOne({ id: { _eq: keyId } });

    if (!oldApiKey || oldApiKey.tenantId !== tenant.tenantId) {
      throw new NotFoundError('API key');
    }

    // Revoke old key
    await this.apiKeyRepo.revoke(
      keyId,
      'system',
      options?.reason || 'API key rotated'
    );

    // Create new key with same name and scopes
    const { apiKey: newApiKey, plainKey } = await this.createApiKey(tenantId, {
      name: oldApiKey.name,
      scopes: oldApiKey.scopes,
      expiresInDays: oldApiKey.expiresAt
        ? Math.ceil((oldApiKey.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
        : undefined,
    });

    // Send email notification if requested
    if (options?.sendEmail !== false) {
      try {
        const emailContent: MailContent = {
          to: tenant.contactEmail,
          subject: 'API Key Rotated - Action Required',
          html: withTemplate(`
            <h2>API Key Rotation Notice</h2>
            <p>Hello <b>${tenant.businessName}</b>,</p>
            <p>Your API key "<strong>${oldApiKey.name}</strong>" has been rotated.</p>

            <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <h3 style="margin-top: 0;">New API Key:</h3>
              <code style="background-color: #fff; padding: 10px; display: block; font-family: monospace; word-break: break-all;">
                ${plainKey}
              </code>
            </div>

            <div style="background-color: #fff3cd; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #ffc107;">
              <strong>⚠️ Important:</strong>
              <ul style="margin: 10px 0;">
                <li>This is the only time you'll see this key</li>
                <li>Store it securely immediately</li>
                <li>Update your applications with the new key</li>
                <li>The old key has been revoked and will no longer work</li>
              </ul>
            </div>

            <p><strong>Key Details:</strong></p>
            <ul>
              <li><strong>Key Name:</strong> ${newApiKey.name}</li>
              <li><strong>Key Prefix:</strong> ${newApiKey.keyPrefix}</li>
              <li><strong>Created:</strong> ${new Date().toLocaleString()}</li>
              ${newApiKey.expiresAt ? `<li><strong>Expires:</strong> ${newApiKey.expiresAt.toLocaleString()}</li>` : ''}
            </ul>

            ${options?.reason ? `<p><strong>Rotation Reason:</strong> ${options.reason}</p>` : ''}

            <p>If you did not request this rotation, please contact support immediately.</p>

            <br/>
          `),
        };

        await this.notifyTenant(emailContent, tenant);
        logger.info('API key rotation email sent', { tenantId, keyId });
      } catch (emailError: any) {
        logger.error('Failed to send API key rotation email', {
          tenantId,
          error: emailError.message,
        });
        // Don't fail the rotation if email fails
      }
    }

    // Audit log
    await this.auditRepo.create({
      tenantId: tenant.tenantId,
      eventId: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      eventType: AuditEventType.API_KEY_CREATED,
      severity: AuditEventSeverity.INFO,
      actor: { actorType: 'system', actorId: 'system' },
      resource: { resourceType: 'api_key', resourceId: newApiKey._id.toString() },
      description: `API key rotated: ${newApiKey.name} (old key: ${keyId})`,
      metadata: {
        oldKeyId: keyId,
        newKeyId: newApiKey._id.toString(),
        reason: options?.reason,
        emailSent: options?.sendEmail !== false,
      },
      timestamp: new Date(),
    });

    return { apiKey: newApiKey, plainKey };
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
   * List all ERP configurations across all tenants (Admin only)
   */
  async listAllERPConfigs(filters?: {
    erpSystem?: string;
    enabled?: boolean;
    skip?: number;
    limit?: number;
  }): Promise<{
    configs: Array<{
      tenantId: string;
      businessName: string;
      contactEmail: string;
      status: string;
      erpSystem?: string;
      erpSyncConfig?: any;
      configuredAt?: Date;
    }>;
    total: number;
  }> {
    const skip = filters?.skip || 0;
    const limit = filters?.limit || 50;

    // Build query
    const query: any = {};
    if (filters?.erpSystem) {
      query['config.erpSystem'] = { _eq: filters.erpSystem };
    }

    // Get all tenants
    const tenants = await this.tenantRepo.findMany(query, skip, limit);
    const total = await this.tenantRepo.count(query);

    // Map tenants to ERP config format
    const configs = tenants
      .map((tenant: any) => {
        const config = tenant.config;
        const erpSyncConfig = config?.erpSyncConfig;

        // Filter by enabled status if specified
        if (filters?.enabled !== undefined && erpSyncConfig?.enabled !== filters.enabled) {
          return null;
        }

        return {
          tenantId: tenant.tenantId,
          businessName: tenant.businessName,
          contactEmail: tenant.contactEmail,
          status: tenant.status,
          erpSystem: config?.erpSystem,
          erpSyncConfig: erpSyncConfig ? {
            name: erpSyncConfig.name,
            description: erpSyncConfig.description,
            enabled: erpSyncConfig.enabled,
            method: erpSyncConfig.method,
            baseUrl: erpSyncConfig.baseUrl,
            endpoint: erpSyncConfig.endpoint,
            authenticationType: erpSyncConfig.authentication?.type,
            hasAuthentication: !!erpSyncConfig.authentication,
            timeout: erpSyncConfig.timeout,
            retryEnabled: erpSyncConfig.retryConfig?.enabled,
          } : null,
          configuredAt: tenant.updatedAt,
        };
      })
      .filter((config) => config !== null);

    return {
      configs,
      total: filters?.enabled !== undefined ? configs.length : total,
    };
  }

  /**
   * List all API keys across all tenants (Admin only)
   */
  async listAllApiKeys(filters?: {
    status?: string;
    tenantId?: string;
    skip?: number;
    limit?: number;
  }): Promise<{
    apiKeys: Array<{
      keyId: string;
      tenantId: string;
      businessName: string;
      contactEmail: string;
      tenantStatus: string;
      keyName: string;
      keyPrefix: string;
      status: string;
      scopes: string[];
      createdAt: Date;
      expiresAt?: Date;
      lastUsedAt?: Date;
      usageCount: number;
    }>;
    total: number;
  }> {
    const skip = filters?.skip || 0;
    const limit = filters?.limit || 50;

    // Build API key query
    const apiKeyQuery: any = {};
    if (filters?.status) {
      apiKeyQuery.status = { _eq: filters.status };
    }
    if (filters?.tenantId) {
      apiKeyQuery.tenantId = { _eq: filters.tenantId };
    }

    // Get all API keys with filters
    const apiKeys = await this.apiKeyRepo.findMany(apiKeyQuery, undefined, limit, skip);
    const total = await this.apiKeyRepo.count(apiKeyQuery);

    // Get unique tenant IDs
    const tenantIds = [...new Set(apiKeys.map((key: any) => key.tenantId))];

    // Fetch all tenants in one query
    const tenants = await this.tenantRepo.findMany(
      { tenantId: { _in: tenantIds } },
      undefined,
      tenantIds.length,
      0
    );

    // Create tenant lookup map
    const tenantMap = new Map(
      tenants.map((tenant: any) => [tenant.tenantId, tenant])
    );

    // Combine API key data with tenant info
    const enrichedApiKeys = apiKeys.map((apiKey: any) => {
      const tenant = tenantMap.get(apiKey.tenantId);

      return {
        keyId: apiKey._id.toString(),
        tenantId: apiKey.tenantId,
        businessName: tenant?.businessName || 'Unknown',
        contactEmail: tenant?.contactEmail || 'N/A',
        tenantStatus: tenant?.status || 'unknown',
        keyName: apiKey.name,
        keyPrefix: apiKey.keyPrefix,
        status: apiKey.status,
        scopes: apiKey.scopes || [],
        createdAt: apiKey.createdAt,
        expiresAt: apiKey.expiresAt,
        lastUsedAt: apiKey.lastUsedAt,
        usageCount: apiKey.usageCount || 0,
      };
    });

    return {
      apiKeys: enrichedApiKeys,
      total,
    };
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
