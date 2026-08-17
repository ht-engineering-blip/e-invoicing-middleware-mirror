/**
 * Tenant Service
 * Business logic for tenant lifecycle management
 */

import crypto from "crypto";
import * as jwt from "jsonwebtoken";
import { appConfig, jwtConfig } from "../../../@config";
import { BaseService, logger } from "../../../@lib";
import {
  decryptSensitiveData,
  encryptSensitiveData,
} from "../../../@lib/crypto";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../../../@lib/errors";
import { MailContent, withTemplate } from "../../../@lib/messaging";
import { templateEngine } from "../../../templates/engine";
import { AuditEventSeverity, AuditEventType } from "../../audit/models";
import {
  ApiKeyStatus,
  OnboardingStatus,
  type TenantDocument,
  TenantOnboardingDocument,
  TenantStatus,
} from "../models";
import { ApiKeyRepository } from "../repos/api-key.repo";
import { TenantOnboardingRepository } from "../repos/tenant-onboarding.repo";
import { TenantRepository } from "../repos/tenant.repo";
import { T } from "@faker-js/faker/dist/index-BSUsvzGS";

export interface ApiKeyDTO {
  keyId: string;
  name: string;
  keyPrefix: string;
  status: ApiKeyStatus;
  scopes: string[];
  createdAt: Date;
  expiresAt?: Date;
  lastUsedAt?: Date;
}

export class TenantService extends BaseService {
  private tenantRepo: TenantRepository;
  private apiKeyRepo: ApiKeyRepository;
  private onboardingRepo: TenantOnboardingRepository;

  constructor() {
    super();
    this.tenantRepo = new TenantRepository();
    this.apiKeyRepo = new ApiKeyRepository();
    this.onboardingRepo = new TenantOnboardingRepository();
  }
  /*
   *Notify Tenant
   */
  async notifyTenant(mail: MailContent, tenant: TenantDocument): Promise<any> {
    // Send customer email to activate their account using BaseService's sendEmail helper.
    let mailContent: MailContent = {
      to: tenant.contactEmail as string,
      subject: mail.subject,
      html: (mail.html || mail.text) as string,
    };
    return await this.sendEmail(mailContent);
  }

  /**
   * Create a new tenant
   */
  async createTenant(
    input: CreateTenantInput,
    actor?: any,
  ): Promise<TenantDocument> {
    // Check if TIN already exists
    const existingTenant = await this.tenantRepo.findByTIN(input.tin);
    if (existingTenant) {
      throw new ConflictError("Tenant with this TIN already exists");
    }

    // Generate business ID
    const tenantId = this.generateBusinessId(input.businessName, input.tin);

    // Generate onboarding activation token ID and expiration (12 hours)
    const activationTokenId = crypto.randomUUID();
    const activationTokenExpiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);

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
      config: { erpSystem: input.erpSystem },
      metadata: {
        activationTokenId,
        activationTokenExpiresAt,
      },
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
      createdBy: actor?.id || "system",
    });

    // Audit log
    await this.createAuditLog({
      tenantId: tenant.tenantId,
      eventType: AuditEventType.TENANT_CREATED,
      description: `Tenant ${tenant.businessName} created`,
      severity: AuditEventSeverity.INFO,
      actorType: actor?.type || "system",
      actorId: actor?.id || "system",
      actorName: actor?.name || "System",
      resourceType: "tenant",
      resourceId: tenant.tenantId,
      resourceName: tenant.businessName,
      metadata: {
        businessName: input.businessName,
        tin: input.tin,
      },
    });

    return tenant;
  }

  /**
   * Get tenant by email or tin
   */
  async getTenantByTinOrEmail(tinOrEmail: string): Promise<TenantDocument> {
    const tenant = await this.tenantRepo.findOne({ search: tinOrEmail });
    console.log({ tenant });
    if (!tenant) {
      throw new NotFoundError("Tenant");
    }
    return tenant;
  }

  /**
   * Get tenant by ID
   */
  async getTenantById(
    tenantId: string,
    includeOnboarding: boolean = false,
  ): Promise<TenantDocument & { onboarding?: TenantOnboardingDocument }> {
    const tenant = await this.tenantRepo.findOne({
      tenantId: { _eq: tenantId },
    });
    if (!tenant) {
      throw new NotFoundError("Tenant");
    }

    if (includeOnboarding) {
      try {
        const onboarding = await this.onboardingRepo.findByTenantId(tenantId);
        return { ...tenant.toObject(), onboarding };
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
  async getTenantByEmail(
    contactEmail: string,
    includeOnboarding: boolean = false,
    includeSensitive: boolean = false,
  ): Promise<TenantDocument & { onboarding?: any }> {
    const tenant = await this.tenantRepo.findOne({
      contactEmail: { _iexact: contactEmail },
    });

    if (!tenant) {
      throw new NotFoundError("Tenant");
    }

    if (includeSensitive) return tenant;

    if (includeOnboarding) {
      try {
        const onboard = await this.onboardingRepo.findByTenantId(contactEmail);
        return { ...this.sanitize(tenant), onboarding: onboard } as any;
      } catch (error) {
        // If onboarding not found, return tenant without it
        return this.sanitize(tenant) as any;
      }
    }

    return this.sanitize(tenant);
  }

  /**
   * Get tenant by business ID
   */
  async getTenantByBusinessId(businessId: string): Promise<TenantDocument> {
    const tenant = await this.tenantRepo.findByBusinessId(businessId);
    if (!tenant) {
      throw new NotFoundError("Tenant");
    }
    return this.sanitize(tenant);
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
  }): Promise<{
    tenants: Array<TenantDocument & { onboarding?: any }>;
    total: number;
  }> {
    const skip = filters?.skip || 0;
    const limit = filters?.limit || 20;

    const query: any = {};
    if (filters?.status) query.status._eq = filters.status;
    if (filters?.erpSystem) query.erpSystem._eq = filters.erpSystem;

    let tenants = await this.tenantRepo.findMany(query, skip, limit);
    const total = await this.tenantRepo.count(query);
    tenants = this.sanitize(tenants);

    // Include onboarding status if requested
    if (filters?.includeOnboarding) {
      const tenantsWithOnboarding = await Promise.all(
        tenants.map(async (tenant) => {
          try {
            const onboarding = await this.onboardingRepo.findByTenantId(
              tenant.tenantId,
            );
            return { ...tenant.toObject(), onboarding };
          } catch (error) {
            // If onboarding not found, return tenant without it
            return tenant;
          }
        }),
      );
      return { tenants: tenantsWithOnboarding, total };
    }

    return { tenants, total };
  }

  /**
   * Update tenant
   */
  async updateTenant(
    tenantId: string,
    input: UpdateTenantInput,
    actor?: any,
  ): Promise<TenantDocument> {
    const tenant = await this.getTenantById(tenantId);

    const updateData: any = {};

    // Validate contactEmail: direct email updates are not allowed for tenants without verification
    if (input.contactEmail !== undefined) {
      const newEmail = input.contactEmail.trim().toLowerCase();
      const currentEmail = (tenant.contactEmail || "").trim().toLowerCase();

      if (newEmail && newEmail !== currentEmail) {
        const isAdmin =
          actor?.isAdmin === true ||
          actor?.type === "system" ||
          actor?.role === "admin";

        if (!isAdmin) {
          throw new ValidationError(
            "Direct email update is not allowed. A tenant must verify their new email address before updating.",
          );
        }

        updateData.contactEmail = newEmail;
      }
    }

    if (input.password) updateData.password = input.password;
    if (input.businessName) updateData.businessName = input.businessName;
    if (input.contactPhone) updateData.contactPhone = input.contactPhone;
    if (input.erpWebhookUrl) updateData.erpWebhookUrl = input.erpWebhookUrl;
    if (input.webhookUrl) updateData.webhookUrl = input.webhookUrl;
    if (input.webhookEnabled !== undefined)
      updateData.webhookEnabled = input.webhookEnabled;
    if (input.passwordChangedAt)
      updateData.passwordChangedAt = input.passwordChangedAt;

    // Encrypt ERP API key if provided
    if (input.erpApiKey) {
      updateData.erpApiKey = encryptSensitiveData(
        input.erpApiKey,
        appConfig?.adminKey,
      );
    }

    // Update features
    if (input.features) {
      updateData["config.features"] = {
        ...tenant?.config?.features,
        ...input.features,
      };
    }

    // Update limits
    if (input.limits) {
      updateData["config.limits"] = {
        ...(tenant?.config?.limits || {}),
        ...(input?.limits || {}),
      };
    }

    // Update Tenant ERP
    if (input.erpSystem) {
      updateData["config.erpSystem"] = input.erpSystem;
    }

    // Update metadata
    if (input.metadata) {
      updateData["metadata"] = {
        ...tenant.metadata,
        ...input.metadata,
      };
    }

    if (input.config) {
      updateData["config"] = {
        ...tenant.config,
        ...input.config,
      };
    }

    console.log({ updateData });

    const updatedTenant = await this.tenantRepo.update(tenantId, updateData);

    // Audit log
    await this.createAuditLog({
      tenantId: tenant.tenantId,
      eventType: AuditEventType.TENANT_UPDATED,
      severity: AuditEventSeverity.INFO,
      actorType: actor?.type || "system",
      actorId: actor?.id || "system",
      actorName: actor?.name,
      resourceType: "tenant",
      resourceId: tenant.tenantId,
      description: "Tenant updated",
      metadata: updateData,
    });

    return updatedTenant!;
  }

  /**
   * Activate tenant
   */
  async activateTenant(tenantId: string, actor?: any): Promise<TenantDocument> {
    const tenant = await this.getTenantById(tenantId);

    if (tenant.status === "active") {
      throw new ValidationError("Tenant is already active");
    }

    const updatedTenant = await this.tenantRepo.activate(tenantId);

    // Audit log
    await this.createAuditLog({
      tenantId: tenant.tenantId,
      eventType: AuditEventType.TENANT_ACTIVATED,
      severity: AuditEventSeverity.INFO,
      actorType: actor?.type || "system",
      actorId: actor?.id || "system",
      actorName: actor?.name,
      resourceType: "tenant",
      resourceId: tenant.tenantId,
      description: "Tenant activated",
      metadata: {},
    });

    return updatedTenant!;
  }

  /**
   * Suspend tenant
   */
  async suspendTenant(
    tenantId: string,
    reason?: string,
    actor?: any,
  ): Promise<TenantDocument> {
    const tenant = await this.getTenantById(tenantId);

    if (tenant.status === "suspended") {
      throw new ValidationError("Tenant is already suspended");
    }

    const updatedTenant = await this.tenantRepo.suspend(tenantId);

    // Audit log
    await this.createAuditLog({
      tenantId: tenant.tenantId,
      eventType: AuditEventType.TENANT_SUSPENDED,
      severity: AuditEventSeverity.WARNING,
      actorType: actor?.type || "system",
      actorId: actor?.id || "system",
      actorName: actor?.name,
      resourceType: "tenant",
      resourceId: tenant.tenantId,
      description: `Tenant suspended${reason ? `: ${reason}` : ""}`,
      metadata: { reason },
    });

    return updatedTenant!;
  }

  /**
   * Delete tenant (soft delete)
   */
  async deleteTenant(tenantId: string, actor?: any): Promise<void> {
    const tenant = await this.getTenantById(tenantId);

    // Check if tenant has active invoices
    // This would require checking invoice counts - implement based on requirements

    await this.tenantRepo.delete(tenantId);

    // Audit log
    await this.createAuditLog({
      tenantId: tenant.tenantId,
      eventType: AuditEventType.TENANT_DELETED,
      severity: AuditEventSeverity.WARNING,
      actorType: actor?.type || "system",
      actorId: actor?.id || "system",
      actorName: actor?.name,
      resourceType: "tenant",
      resourceId: tenant.tenantId,
      description: "Tenant deleted",
      metadata: {},
    });
  }

  /**
   * Update FIRS credentials
   */
  async updateFIRSCredentials(
    tenantId: string,
    credentials: FIRSCredentialsInput,
    actor?: any,
  ): Promise<TenantDocument> {
    const tenant = await this.getTenantById(tenantId);
    let updateData: any = {
      serviceId: credentials.serviceId,
    };
    // Encrypt sensitive credentials
    if (credentials.certificate && credentials.publicKey) {
      const encryptedCertificate = encryptSensitiveData(
        credentials.certificate,
      );
      const encryptedPublicKey = encryptSensitiveData(credentials.publicKey);

      updateData = {
        ...updateData,
        certificate: encryptedCertificate,
        publicKey: encryptedPublicKey,
      };
    }

    if (credentials.clientId) {
      updateData["clientId"] = encryptSensitiveData(credentials.clientId);
    }
    if (credentials.apiKey) {
      updateData["apiKey"] = encryptSensitiveData(credentials.apiKey);
    }
    if (credentials.apiSecret) {
      updateData["apiSecret"] = encryptSensitiveData(credentials.apiSecret);
    }
    console.log({ updateData });
    const updatedTenant = await this.tenantRepo.updateFIRSCredentials(
      tenantId,
      updateData,
    );

    // Audit log
    await this.createAuditLog({
      tenantId: tenant.tenantId,
      eventType: AuditEventType.TENANT_UPDATED,
      severity: AuditEventSeverity.INFO,
      actorType: actor?.type || "system",
      actorId: actor?.id || "system",
      actorName: actor?.name,
      resourceType: "tenant",
      resourceId: tenant.tenantId,
      description: "FIRS credentials updated",
      metadata: {},
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
      throw new NotFoundError("FIRS credentials not configured");
    }

    const certificate = decryptSensitiveData(
      tenant.config.firsCredentials.certificate,
    );
    const publicKey = decryptSensitiveData(
      tenant.config.firsCredentials.publicKey!,
    );

    const result: any = {
      certificate,
      publicKey,
      /*   privateKey, */
    };

    if (tenant.config.firsCredentials.clientId) {
      result.clientId = decryptSensitiveData(
        tenant.config.firsCredentials.clientId,
      );
    }

    return result;
  }

  /**
   * Create API key for tenant
   */
  async createApiKey(
    tenantId: string,
    input: CreateApiKeyInput,
    actor?: any,
  ): Promise<{ apiKey: ApiKeyDTO; plainKey: string }> {
    const tenant = await this.getTenantById(tenantId);

    // Generate API key
    const plainKey = this.generateApiKey();
    const keyHash = await this.hashString(plainKey);
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
    await this.createAuditLog({
      tenantId: tenant.tenantId,
      eventType: AuditEventType.API_KEY_CREATED,
      severity: AuditEventSeverity.INFO,
      actorType: actor?.type || "system",
      actorId: actor?.id || "system",
      actorName: actor?.name || "System",
      resourceType: "api_key",
      resourceId: apiKey._id.toString(),
      description: `API key created: ${input.name}`,
      metadata: { name: input.name, keyPrefix },
    });

    const apiKeyDto: ApiKeyDTO = {
      keyId: apiKey._id.toString(),
      name: apiKey.name,
      keyPrefix: apiKey.keyPrefix,
      status: apiKey.status,
      scopes: apiKey.scopes || [],
      createdAt: apiKey.createdAt,
      expiresAt: apiKey.expiresAt,
      lastUsedAt: apiKey.lastUsedAt,
    };

    return { apiKey: apiKeyDto, plainKey };
  }

  /**
   * List API keys for tenant
   */
  async listApiKeys(
    tenantId: string,
  ): Promise<{ data: ApiKeyDTO[]; meta: any }> {
    const tenant = await this.getTenantById(tenantId);
    const result = await this.apiKeyRepo.findByTenantId(tenantId);
    const safeData = result.data.map((apiKey: any) => ({
      keyId: apiKey._id.toString(),
      name: apiKey.name,
      keyPrefix: apiKey.keyPrefix,
      status: apiKey.status,
      scopes: apiKey.scopes || [],
      createdAt: apiKey.createdAt,
      expiresAt: apiKey.expiresAt,
      lastUsedAt: apiKey.lastUsedAt,
    }));
    return {
      data: safeData,
      meta: result.meta,
    };
  }

  /**
   * Revoke API key
   */
  async revokeApiKey(
    tenantId: string,
    keyId: string,
    reason?: string,
    actor?: any,
  ): Promise<void> {
    const tenant = await this.getTenantById(tenantId);
    const apiKey = await this.apiKeyRepo.findOne({ id: { _eq: keyId } });

    if (!apiKey || apiKey.tenantId !== tenant.tenantId) {
      throw new NotFoundError("API key");
    }

    await this.apiKeyRepo.revoke(keyId, actor?.id || "system", reason!);

    // Audit log
    await this.createAuditLog({
      tenantId: tenant.tenantId,
      eventType: AuditEventType.API_KEY_REVOKED,
      severity: AuditEventSeverity.WARNING,
      actorType: actor?.type || "system",
      actorId: actor?.id || "system",
      actorName: actor?.name || "System",
      resourceType: "api_key",
      resourceId: keyId,
      description: `API key revoked${reason ? `: ${reason}` : ""}`,
      metadata: { reason },
    });
  }

  /**
   * Rotate API key (revoke old and create new)
   */
  async rotateApiKey(
    tenantId: string,
    keyId: string,
    options?: { sendEmail?: boolean; reason?: string },
    actor?: any,
  ): Promise<{ apiKey: ApiKeyDTO; plainKey: string }> {
    const tenant = await this.getTenantById(tenantId);
    const oldApiKey = await this.apiKeyRepo.findOne({ id: { _eq: keyId } });

    if (!oldApiKey || oldApiKey.tenantId !== tenant.tenantId) {
      throw new NotFoundError("API key");
    }

    // Revoke old key
    await this.apiKeyRepo.revoke(
      keyId,
      actor?.id || "system",
      options?.reason || "API key rotated",
    );

    // Create new key with same name and scopes
    const { apiKey: newApiKey, plainKey } = await this.createApiKey(
      tenantId,
      {
        name: oldApiKey.name,
        scopes: oldApiKey.scopes,
        expiresInDays: oldApiKey.expiresAt
          ? Math.ceil(
              (oldApiKey.expiresAt.getTime() - Date.now()) /
                (24 * 60 * 60 * 1000),
            )
          : undefined,
      },
      actor,
    );

    // Send email notification if requested
    if (options?.sendEmail !== false) {
      try {
        const emailContent: MailContent = {
          to: tenant.contactEmail,
          subject: "API Key Rotated - Action Required",
          html: withTemplate(
            templateEngine.render("apiKeyRotated", {
              businessName: tenant.businessName,
              oldKeyName: oldApiKey.name,
              plainKey,
              newKeyName: newApiKey.name,
              newKeyPrefix: newApiKey.keyPrefix,
              created: new Date().toLocaleString(),
              expires: newApiKey.expiresAt
                ? newApiKey.expiresAt.toLocaleString()
                : undefined,
              reason: options?.reason,
            }),
          ),
        };

        await this.notifyTenant(emailContent, tenant);
        logger.info("API key rotation email sent", { tenantId, keyId });
      } catch (emailError: any) {
        logger.error("Failed to send API key rotation email", {
          tenantId,
          error: emailError.message,
        });
        // Don't fail the rotation if email fails
      }
    }

    // Audit log
    await this.createAuditLog({
      tenantId: tenant.tenantId,
      eventType: AuditEventType.API_KEY_CREATED,
      severity: AuditEventSeverity.INFO,
      actorType: actor?.type || "system",
      actorId: actor?.id || "system",
      actorName: actor?.name || "System",
      resourceType: "api_key",
      resourceId: newApiKey.keyId,
      description: `API key rotated: ${newApiKey.name} (old key: ${keyId})`,
      metadata: {
        oldKeyId: keyId,
        newKeyId: newApiKey.keyId,
        reason: options?.reason,
        emailSent: options?.sendEmail !== false,
      },
    });

    return { apiKey: newApiKey, plainKey };
  }

  /**
   * Get onboarding status
   */
  async getOnboardingStatus(
    tenantId: string,
  ): Promise<TenantOnboardingDocument> {
    const tenant = await this.getTenantById(tenantId);
    const onboarding = await this.onboardingRepo.findByTenantId(
      tenant.tenantId,
    );

    if (!onboarding) {
      throw new NotFoundError("Onboarding record");
    }

    // Sync step status from actual tenant configuration if needed
    if (tenant) {
      let stepUpdated = false;

      // 1. Registration: completed if tenant account exists
      if (
        !onboarding.steps?.registration?.completed &&
        (tenant.tenantId ||
          tenant.password ||
          tenant.metadata?.activationCompleted)
      ) {
        await this.onboardingRepo.completeStep(tenant.tenantId, "registration");
        onboarding.steps.registration = {
          completed: true,
          completedAt: tenant.createdAt || new Date(),
        };
        stepUpdated = true;
      }

      // 2. FIRS Provisioning: completed if firs credentials serviceId/clientId exist
      if (
        !onboarding.steps?.firsProvisioning?.completed &&
        (tenant.config?.firsCredentials?.serviceId ||
          tenant.config?.firsCredentials?.clientId)
      ) {
        await this.onboardingRepo.completeStep(
          tenant.tenantId,
          "firsProvisioning",
        );
        onboarding.steps.firsProvisioning = {
          completed: true,
          completedAt: new Date(),
        };
        stepUpdated = true;
      }

      // 3. ERP Configuration: completed if webhookUrl exist
      if (
        !onboarding.steps?.erpConfiguration?.completed &&
        (tenant.config?.webhookUrl || tenant.metadata?.webhookUrl)
      ) {
        await this.onboardingRepo.completeStep(
          tenant.tenantId,
          "erpConfiguration",
        );
        onboarding.steps.erpConfiguration = {
          completed: true,
          completedAt: new Date(),
        };
        stepUpdated = true;
      }

      if (stepUpdated && onboarding.status === "pending") {
        await this.onboardingRepo.updateStatus(
          tenant.tenantId,
          OnboardingStatus.IN_PROGRESS,
        );
        onboarding.status = OnboardingStatus.IN_PROGRESS;
      }
    }

    return onboarding;
  }

  /**
   * Complete an onboarding step
   */
  async completeOnboardingStep(
    tenantId: string,
    step:
      | "registration"
      | "firsProvisioning"
      | "erpConfiguration"
      | "testing"
      | "goLive",
    actor?: any,
  ): Promise<TenantOnboardingDocument> {
    const tenant = await this.getTenantById(tenantId);

    const updated = await this.onboardingRepo.completeStep(
      tenant.tenantId,
      step,
    );

    // Audit log
    await this.createAuditLog({
      tenantId: tenant.tenantId,
      eventType: AuditEventType.TENANT_UPDATED,
      severity: AuditEventSeverity.INFO,
      actorType: actor?.type || "system",
      actorId: actor?.id || "system",
      actorName: actor?.name,
      resourceType: "onboarding",
      resourceId: updated.tenantId,
      description: `Onboarding step completed: ${step}`,
      metadata: { step, action: "onboarding.step_completed" },
    });

    return updated;
  }

  /**
   * Update onboarding status
   */
  async updateOnboarding(
    tenantId: string,
    input: UpdateOnboardingInput,
    actor?: any,
  ): Promise<TenantOnboardingDocument> {
    const tenant = await this.getTenantById(tenantId);
    const onboarding = await this.onboardingRepo.findByTenantId(
      tenant.tenantId,
    );

    if (!onboarding) {
      throw new NotFoundError("Onboarding record");
    }

    const updateData: any = {};

    if (input.status) updateData.status = input.status;
    if (input.notes) updateData.notes = input.notes;
    if (input.rejectionReason)
      updateData.rejectionReason = input.rejectionReason;

    const updated = await this.onboardingRepo.update(
      tenant.tenantId,
      updateData,
    );

    // Audit log
    await this.createAuditLog({
      tenantId: tenant.tenantId,
      eventType: AuditEventType.TENANT_UPDATED,
      severity: AuditEventSeverity.INFO,
      actorType: actor?.type || "system",
      actorId: actor?.id || "system",
      actorName: actor?.name,
      resourceType: "onboarding",
      resourceId: onboarding._id.toString(),
      description: "Tenant onboarding status updated",
      metadata: { ...updateData, action: "onboarding.status_updated" },
    });

    return updated!;
  }

  /**
   * Approve onboarding
   */
  async approveOnboarding(tenantId: string, actor?: any): Promise<void> {
    const tenant = await this.getTenantById(tenantId);
    const onboarding = await this.onboardingRepo.findByTenantId(
      tenant.tenantId,
    );

    if (!onboarding) {
      throw new NotFoundError("Onboarding record");
    }

    await this.onboardingRepo.approve(tenantId, actor?.id || "system");
    await this.activateTenant(tenantId, actor);

    // Audit log
    await this.createAuditLog({
      tenantId,
      eventType: AuditEventType.TENANT_ACTIVATED,
      severity: AuditEventSeverity.INFO,
      actorType: actor?.type || "system",
      actorId: actor?.id || "system",
      actorName: actor?.name,
      resourceType: "onboarding",
      resourceId: onboarding._id.toString(),
      description: "Tenant onboarding approved",
      metadata: {},
    });
  }

  /**
   * Reject onboarding
   */
  async rejectOnboarding(
    tenantId: string,
    reason: string,
    actor?: any,
  ): Promise<void> {
    const tenant = await this.getTenantById(tenantId);
    const onboarding = await this.onboardingRepo.findByTenantId(
      tenant.tenantId,
    );

    if (!onboarding) {
      throw new NotFoundError("Onboarding record");
    }

    await this.onboardingRepo.reject(onboarding._id.toString(), reason);

    // Audit log
    await this.createAuditLog({
      tenantId,
      eventType: AuditEventType.TENANT_UPDATED,
      severity: AuditEventSeverity.WARNING,
      actorType: actor?.type || "system",
      actorId: actor?.id || "system",
      actorName: actor?.name,
      resourceType: "onboarding",
      resourceId: onboarding._id.toString(),
      description: `Tenant onboarding rejected: ${reason}`,
      metadata: { reason },
    });
  }

  /**
   * Configure ERP sync settings
   */
  async configureERPSync(
    tenantId: string,
    config: ERPSyncConfigInput,
    actor?: any,
  ): Promise<TenantDocument> {
    const tenant = await this.getTenantById(tenantId);

    // Validate ERP Sync URL endpoints for SSRF and loopback interfaces
    if (config.baseUrl) {
      if (!(await this.isSafeUrl(config.baseUrl))) {
        throw new ValidationError(
          `ERP Sync baseUrl is blocked by SSRF guard: ${config.baseUrl}`,
        );
      }
    }
    if (config.endpoint && config.endpoint.startsWith("http")) {
      if (!(await this.isSafeUrl(config.endpoint))) {
        throw new ValidationError(
          `ERP Sync endpoint is blocked by SSRF guard: ${config.endpoint}`,
        );
      }
    }

    // Encrypt sensitive authentication data
    const encryptedConfig: any = { ...config };

    if (config.authentication) {
      if (config.authentication.password) {
        encryptedConfig.authentication.password = encryptSensitiveData(
          config.authentication.password,
          appConfig?.adminKey,
        );
      }
      if (config.authentication.token) {
        encryptedConfig.authentication.token = encryptSensitiveData(
          config.authentication.token,
          appConfig?.adminKey,
        );
      }
      if (config.authentication.apiKeyValue) {
        encryptedConfig.authentication.apiKeyValue = encryptSensitiveData(
          config.authentication.apiKeyValue,
          appConfig?.adminKey,
        );
      }
    }

    // Update tenant with ERP sync configuration
    const updateData: any = {
      "config.erpSyncConfig": encryptedConfig,
    };

    const updatedTenant = await this.tenantRepo.update(tenantId, updateData);

    // Audit log
    await this.createAuditLog({
      tenantId: tenant.tenantId,
      eventType: AuditEventType.TENANT_UPDATED,
      severity: AuditEventSeverity.INFO,
      actorType: actor?.type || "system",
      actorId: actor?.id || "system",
      actorName: actor?.name,
      resourceType: "tenant",
      resourceId: tenant.tenantId,
      description: `ERP sync configuration updated: ${config.name}`,
      metadata: {
        configName: config.name,
        method: config.method,
        endpoint: config.endpoint,
        enabled: config.enabled,
        action: "tenant.erp_sync_configured",
      },
    });

    return updatedTenant!;
  }

  /**
   * Get ERP sync configuration with decrypted credentials
   */
  async getERPSyncConfig(tenantId: string): Promise<ERPSyncConfigInput | null> {
    const tenant = await this.getTenantById(tenantId);

    const tenantObj = tenant.toObject
      ? tenant.toObject({ flattenMaps: true })
      : JSON.parse(JSON.stringify(tenant));

    const config = tenantObj.config?.erpSyncConfig;
    if (!config) {
      return null;
    }

    // Decrypt sensitive data
    const decryptedConfig = { ...config };

    if (decryptedConfig.authentication) {
      decryptedConfig.authentication = { ...decryptedConfig.authentication };
      if (decryptedConfig.authentication.password) {
        decryptedConfig.authentication.password = decryptSensitiveData(
          decryptedConfig.authentication.password,
          appConfig?.adminKey,
        );
      }
      if (decryptedConfig.authentication.token) {
        decryptedConfig.authentication.token = decryptSensitiveData(
          decryptedConfig.authentication.token,
          appConfig?.adminKey,
        );
      }
      if (decryptedConfig.authentication.apiKeyValue) {
        decryptedConfig.authentication.apiKeyValue = decryptSensitiveData(
          decryptedConfig.authentication.apiKeyValue,
          appConfig?.adminKey,
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
      query["config.erpSystem"] = { _eq: filters.erpSystem };
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
        if (
          filters?.enabled !== undefined &&
          erpSyncConfig?.enabled !== filters.enabled
        ) {
          return null;
        }

        return {
          tenantId: tenant.tenantId,
          businessName: tenant.businessName,
          contactEmail: tenant.contactEmail,
          status: tenant.status,
          erpSystem: config?.erpSystem,
          erpSyncConfig: erpSyncConfig
            ? {
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
              }
            : null,
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
    const apiKeys = await this.apiKeyRepo.findMany(
      apiKeyQuery,
      undefined,
      limit,
      skip,
    );
    const total = await this.apiKeyRepo.count(apiKeyQuery);

    // Get unique tenant IDs
    const tenantIds = [...new Set(apiKeys.map((key: any) => key.tenantId))];

    // Fetch all tenants in one query
    const tenants = await this.tenantRepo.findMany(
      { tenantId: { _in: tenantIds } },
      undefined,
      tenantIds.length,
      0,
    );

    // Create tenant lookup map
    const tenantMap = new Map(
      tenants.map((tenant: any) => [tenant.tenantId, tenant]),
    );

    // Combine API key data with tenant info
    const enrichedApiKeys = apiKeys.map((apiKey: any) => {
      const tenant = tenantMap.get(apiKey.tenantId);

      return {
        keyId: apiKey._id.toString(),
        tenantId: apiKey.tenantId,
        businessName: tenant?.businessName || "Unknown",
        contactEmail: tenant?.contactEmail || "N/A",
        tenantStatus: tenant?.status || "unknown",
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
   * Get the activation token expiration date without using ternary operators.
   */
  getActivationTokenExpiry(tenant: any): Date | null {
    if (!tenant) {
      return null;
    }
    if (!tenant.metadata) {
      return null;
    }
    if (!tenant.metadata.activationTokenExpiresAt) {
      return null;
    }
    return new Date(tenant.metadata.activationTokenExpiresAt);
  }

  /**
   * Checks if an activation token is valid based on its ID and expiration date.
   * Completely avoids ternary operators.
   */
  isActivationTokenValid(tenant: any, decodedTokenId: string): boolean {
    if (!tenant) {
      return false;
    }
    if (!tenant.metadata) {
      return false;
    }
    if (!tenant.metadata.activationTokenId) {
      return false;
    }
    if (tenant.metadata.activationTokenId !== decodedTokenId) {
      return false;
    }
    const expiresAt = this.getActivationTokenExpiry(tenant);
    if (!expiresAt) {
      return false;
    }
    const now = new Date();
    if (expiresAt < now) {
      return false;
    }
    return true;
  }

  /**
   * Checks if the activation token is still within its valid timeframe (not expired)
   */
  isActivationTokenInTimeframe(tenant: any): boolean {
    if (!tenant) {
      return false;
    }
    if (!tenant.metadata) {
      return false;
    }
    if (!tenant.metadata.activationTokenId) {
      return false;
    }
    const expiresAt = this.getActivationTokenExpiry(tenant);
    if (!expiresAt) {
      return false;
    }
    const now = new Date();
    if (expiresAt > now) {
      return true;
    }
    return false;
  }

  /**
   * Request email change verification
   * Generates a 12-hour signed JWT verification token and sends verification link to the new email address
   */
  async requestEmailChange(
    tenantId: string,
    newEmail: string,
    actor?: any,
  ): Promise<{ success: boolean; message: string }> {
    const tenant = await this.getTenantById(tenantId);
    const normalizedNewEmail = (newEmail || "").trim().toLowerCase();

    if (!this.isValidEmail(normalizedNewEmail)) {
      throw new ValidationError("Invalid email address format");
    }

    if (
      normalizedNewEmail === (tenant.contactEmail || "").trim().toLowerCase()
    ) {
      throw new ValidationError(
        "New email must be different from current contact email",
      );
    }

    // Check if another tenant is already using this email
    const existing = await this.tenantRepo.findOne({
      contactEmail: { _eq: normalizedNewEmail },
      tenantId: { _ne: tenantId },
    });

    if (existing) {
      throw new ConflictError("Email is already in use by another tenant");
    }

    const verificationToken = await this.createAuthToken(
      {
        ...tenant.toObject(),
        contactEmail: normalizedNewEmail,
        newEmail: normalizedNewEmail,
      },
      "12HRS",
    );

    const verificationLink = `${appConfig?.webAppURL}/auth/verify-email?_u=${verificationToken}`;
    const verificationEmail: MailContent = {
      subject: "Verify your new email address",
      html: withTemplate(
        templateEngine.render("verifyEmailChange", {
          businessName: tenant.businessName,
          newEmail: normalizedNewEmail,
          verificationLink,
        }),
      ),
    };

    await this.sendEmail({
      to: normalizedNewEmail,
      subject: verificationEmail.subject,
      html: verificationEmail.html,
    });

    logger.info("Email change verification sent", {
      tenantId,
      newEmail: normalizedNewEmail,
    });

    return {
      success: true,
      message: `Verification link sent to ${normalizedNewEmail}`,
    };
  }

  /**
   * Verify and confirm email change using JWT token
   */
  async verifyEmailChange(
    tenantId: string,
    token: string,
    actor?: any,
  ): Promise<{ success: boolean; contactEmail: string; message: string }> {
    if (!token) {
      throw new ValidationError("Verification token is required");
    }

    let decoded: any;
    try {
      const jwtSecret = jwtConfig?.secret as string;
      const jwtAlgorithm = jwtConfig?.algorithm as jwt.Algorithm;
      decoded = jwt.verify(token, jwtSecret, {
        algorithms: [jwtAlgorithm],
      });
    } catch (err: any) {
      throw new ValidationError("Invalid or expired verification token");
    }

    const tokenTenantId = decoded.tenantId;
    if (tenantId && tokenTenantId && tenantId !== tokenTenantId) {
      throw new ValidationError("Token does not belong to this tenant");
    }

    const newEmail = (
      decoded.newEmail ||
      decoded.contactEmail ||
      decoded.email ||
      ""
    )
      .trim()
      .toLowerCase();

    if (!newEmail || !this.isValidEmail(newEmail)) {
      throw new ValidationError("Invalid email in token payload");
    }

    const targetTenantId = tenantId || tokenTenantId;
    const tenant = await this.getTenantById(targetTenantId);

    // Check again if email was taken by another tenant in the meantime
    const existing = await this.tenantRepo.findOne({
      contactEmail: { _eq: newEmail },
      tenantId: { _ne: targetTenantId },
    });

    if (existing) {
      throw new ConflictError("Email is already in use by another tenant");
    }

    await this.tenantRepo.update(targetTenantId, {
      contactEmail: newEmail,
    });

    // Audit log
    await this.createAuditLog({
      tenantId: tenant.tenantId,
      eventType: AuditEventType.TENANT_UPDATED,
      severity: AuditEventSeverity.INFO,
      actorType: actor?.type || "user",
      actorId: actor?.id || tenant.tenantId,
      actorName: actor?.name || tenant.businessName,
      resourceType: "tenant",
      resourceId: tenant.tenantId,
      description: `Tenant contact email updated to ${newEmail} after verification`,
      metadata: { previousEmail: tenant.contactEmail, newEmail },
    });

    logger.info(
      "Tenant contact email successfully updated after verification",
      {
        tenantId: targetTenantId,
        oldEmail: tenant.contactEmail,
        newEmail,
      },
    );

    return {
      success: true,
      contactEmail: newEmail,
      message: "Contact email updated successfully",
    };
  }

  /**
   * Private: Generate business ID
   */
  private generateBusinessId(businessName: string, tin: string): string {
    const prefix = businessName
      .substring(0, 3)
      .toUpperCase()
      .replace(/[^A-Z]/g, "");
    const tinSuffix = tin.substring(tin.length - 4);
    const random = this.generateRandomString(4).substring(0, 4).toUpperCase();
    return `${prefix}-${tinSuffix}-${random}`;
  }

  /**
   * Private: Generate API key
   */
  private generateApiKey(): string {
    return `sk_${this.generateRandomString(32)}`;
  }
}
