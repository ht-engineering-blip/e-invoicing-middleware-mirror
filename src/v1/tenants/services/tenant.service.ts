/**
 * Tenant Service
 * High-performance, modular business logic for tenant lifecycle management.
 * Delegates to focused subservices while providing a unified facade.
 */

import crypto from "crypto";
import * as jwt from "jsonwebtoken";
import { jwtConfig } from "../../../@config";
import { BaseService, logger, TIME_MS } from "../../../@lib";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../../../@lib/errors";
import { MailContent, withTemplate } from "../../../@lib/messaging";
import { templateEngine } from "../../../templates/engine";
import { AuditEventSeverity, AuditEventType } from "../../audit/models";
import {
  OnboardingStatus,
  TenantOnboardingDocument,
  TenantStatus,
  type TenantDocument,
} from "../models";
import { ApiKeyRepository } from "../repos/api-key.repo";
import { TenantOnboardingRepository } from "../repos/tenant-onboarding.repo";
import { TenantRepository } from "../repos/tenant.repo";
import {
  TenantApiKeyService,
  TenantAuthChallengeService,
  TenantCredentialService,
  TenantErpConfigService,
  TenantOnboardingService,
  type ApiKeyDTO,
  type DecryptedFIRSCredentials,
} from "./subservices";

export type { ApiKeyDTO };

export class TenantService extends BaseService {
  private tenantRepo: TenantRepository;
  private apiKeyRepo: ApiKeyRepository;
  private onboardingRepo: TenantOnboardingRepository;

  // Subservices
  private credentialService: TenantCredentialService;
  private apiKeyService: TenantApiKeyService;
  private onboardingService: TenantOnboardingService;
  private erpConfigService: TenantErpConfigService;
  private authChallengeService: TenantAuthChallengeService;

  constructor(dependencies?: {
    tenantRepo?: TenantRepository;
    apiKeyRepo?: ApiKeyRepository;
    onboardingRepo?: TenantOnboardingRepository;
  }) {
    super();
    this.tenantRepo = dependencies?.tenantRepo ?? new TenantRepository();
    this.apiKeyRepo = dependencies?.apiKeyRepo ?? new ApiKeyRepository();
    this.onboardingRepo =
      dependencies?.onboardingRepo ?? new TenantOnboardingRepository();

    this.credentialService = new TenantCredentialService(this.tenantRepo);
    this.apiKeyService = new TenantApiKeyService(
      this.apiKeyRepo,
      this.tenantRepo,
    );
    this.onboardingService = new TenantOnboardingService(this.onboardingRepo);
    this.erpConfigService = new TenantErpConfigService(this.tenantRepo);
    this.authChallengeService = new TenantAuthChallengeService();
  }

  /**
   * Helper: Generate business ID
   */
  generateBusinessId(businessName: string, tin: string): string {
    const prefix = businessName
      .substring(0, 3)
      .toUpperCase()
      .replace(/[^A-Z]/g, "");
    const tinSuffix = tin.substring(tin.length - 4);
    const random = this.generateRandomString(4).substring(0, 4).toUpperCase();
    return `${prefix}-${tinSuffix}-${random}`;
  }

  /**
   * Helper: Generate API key
   */
  generateApiKey(): string {
    return this.apiKeyService.generateApiKey();
  }

  /**
   * Notify Tenant via email
   */
  async notifyTenant(mail: MailContent, tenant: TenantDocument): Promise<any> {
    const mailContent: MailContent = {
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
    const existingTenant = await this.tenantRepo.findByTIN(input.tin);
    if (existingTenant) {
      throw new ConflictError("Tenant with this TIN already exists");
    }

    const tenantId = this.generateBusinessId(input.businessName, input.tin);
    const activationTokenId = crypto.randomUUID();
    const activationTokenExpiresAt = new Date(
      Date.now() + TIME_MS.TWELVE_HOURS,
    );

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
        ...input,
        businessName: input.businessName,
        tin: input.tin,
        payload: input,
      },
    });

    return tenant;
  }

  /**
   * Get tenant by email or TIN
   */
  async getTenantByTinOrEmail(tinOrEmail: string): Promise<TenantDocument> {
    const tenant = await this.tenantRepo.findOne({ search: tinOrEmail });
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
        const rawTenant =
          typeof tenant.toObject === "function" ? tenant.toObject() : tenant;
        return { ...rawTenant, onboarding };
      } catch (error) {
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
        const onboard = await this.onboardingRepo.findByTenantId(
          tenant.tenantId,
        );
        const rawTenant =
          typeof tenant.toObject === "function" ? tenant.toObject() : tenant;
        return { ...this.sanitize(rawTenant), onboarding: onboard } as any;
      } catch (error) {
        return this.sanitize(tenant);
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
    search?: string;
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
    if (filters?.status) query.status = { _eq: filters.status };
    if (filters?.erpSystem) query.erpSystem = { _eq: filters.erpSystem };
    if (filters?.search) query.search = filters.search;

    const [tenants, total] = await Promise.all([
      this.tenantRepo.findMany(query, undefined, limit, skip),
      this.tenantRepo.count(query),
    ]);

    if (filters?.includeOnboarding) {
      const tenantsWithOnboarding = await Promise.all(
        tenants.map(async (tenant) => {
          try {
            const rawTenant =
              typeof tenant.toObject === "function"
                ? tenant.toObject()
                : tenant;
            const onboarding = await this.onboardingRepo.findByTenantId(
              tenant.tenantId,
            );
            return { ...this.sanitize(rawTenant), onboarding };
          } catch (error) {
            return this.sanitize(tenant);
          }
        }),
      );
      return { tenants: tenantsWithOnboarding, total };
    }

    return { tenants: this.sanitize(tenants), total };
  }

  /**
   * Get tenant analytics counts
   */
  async getTenantAnalytics(): Promise<{
    total: number;
    active: number;
    invited: number;
    suspended: number;
  }> {
    const [total, active, invited, suspended] = await Promise.all([
      this.tenantRepo.count({}),
      this.tenantRepo.count({ status: { _eq: TenantStatus.ACTIVE } }),
      this.tenantRepo.count({ status: { _eq: TenantStatus.ONBOARDING } }),
      this.tenantRepo.count({ status: { _eq: TenantStatus.SUSPENDED } }),
    ]);

    return { total, active, invited, suspended };
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
    const tenantObj =
      typeof tenant.toObject === "function" ? tenant.toObject() : tenant;

    const updateData: any = {};

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
    if (input.webhookEnabled !== undefined) {
      updateData.webhookEnabled = input.webhookEnabled;
    }
    if (input.webhookExpiresAt !== undefined) {
      updateData.webhookExpiresAt = input.webhookExpiresAt;
    }
    if (input.webhookLifespan !== undefined) {
      updateData.webhookLifespan = input.webhookLifespan;
    }
    if (input.passwordChangedAt) {
      updateData.passwordChangedAt = input.passwordChangedAt;
    }
    if (input.status) updateData.status = input.status;

    if (input.features) {
      updateData["config.features"] = {
        ...tenantObj.config?.features,
        ...input.features,
      };
    }

    if (input.limits) {
      updateData["config.limits"] = {
        ...(tenantObj.config?.limits || {}),
        ...(input?.limits || {}),
      };
    }

    if (input.erpSystem) {
      updateData["config.erpSystem"] = input.erpSystem;
    }

    if (input.metadata) {
      updateData["metadata"] = {
        ...tenantObj.metadata,
        ...input.metadata,
      };
    }

    if (input.config) {
      updateData["config"] = {
        ...tenantObj.config,
        ...input.config,
      };
    }

    const updatedTenant = await this.tenantRepo.update(tenantId, updateData);

    this.credentialService.invalidateCache(tenantId);

    if (
      updateData.contactEmail &&
      updateData.contactEmail !==
        (tenant.contactEmail || "").trim().toLowerCase()
    ) {
      const oldEmail = (tenant.contactEmail || "").trim().toLowerCase();
      const newEmail = updateData.contactEmail;
      const successEmailContent: MailContent = {
        subject: "Contact Email Changed Successfully",
        html: withTemplate(
          templateEngine.render("emailChangeSuccessNotification", {
            businessName: tenant.businessName,
            oldEmail: oldEmail || "N/A",
            newEmail,
          }),
        ),
      };

      this.sendEmail({
        to: newEmail,
        subject: successEmailContent.subject,
        html: successEmailContent.html,
      }).catch((err) =>
        logger.warn("Failed to send email change notification to new email", {
          tenantId,
          newEmail,
          error: err.message,
        }),
      );

      if (oldEmail && oldEmail !== newEmail && this.isValidEmail(oldEmail)) {
        this.sendEmail({
          to: oldEmail,
          subject: successEmailContent.subject,
          html: successEmailContent.html,
        }).catch((err) =>
          logger.warn("Failed to send email change notification to old email", {
            tenantId,
            oldEmail,
            error: err.message,
          }),
        );
      }
    }

    await this.createAuditLog({
      tenantId: tenant.tenantId,
      eventType: AuditEventType.TENANT_UPDATED,
      severity: AuditEventSeverity.INFO,
      actorType: actor?.type || "system",
      actorId: actor?.id || "system",
      actorName: actor?.name,
      resourceType: "tenant",
      resourceId: tenant.tenantId,
      resourceName: tenant.businessName,
      description: `Tenant updated: ${tenant.businessName}`,
      metadata: {
        ...updateData,
        payload: updateData,
      },
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

    await this.createAuditLog({
      tenantId: tenant.tenantId,
      eventType: AuditEventType.TENANT_ACTIVATED,
      severity: AuditEventSeverity.INFO,
      actorType: actor?.type || "system",
      actorId: actor?.id || "system",
      actorName: actor?.name,
      resourceType: "tenant",
      resourceId: tenant.tenantId,
      resourceName: tenant.businessName,
      description: `Tenant activated: ${tenant.businessName}`,
      metadata: {
        payload: { tenantId, status: "active" },
      },
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

    await this.createAuditLog({
      tenantId: tenant.tenantId,
      eventType: AuditEventType.TENANT_SUSPENDED,
      severity: AuditEventSeverity.WARNING,
      actorType: actor?.type || "system",
      actorId: actor?.id || "system",
      actorName: actor?.name,
      resourceType: "tenant",
      resourceId: tenant.tenantId,
      resourceName: tenant.businessName,
      description: `Tenant suspended${reason ? `: ${reason}` : ""}`,
      metadata: {
        reason,
        payload: { tenantId, reason, status: "suspended" },
      },
    });

    return updatedTenant!;
  }

  /**
   * Delete tenant (soft delete)
   */
  async deleteTenant(tenantId: string, actor?: any): Promise<void> {
    const tenant = await this.getTenantById(tenantId);
    await this.tenantRepo.delete(tenantId);
    this.credentialService.invalidateCache(tenantId);

    await this.createAuditLog({
      tenantId: tenant.tenantId,
      eventType: AuditEventType.TENANT_DELETED,
      severity: AuditEventSeverity.WARNING,
      actorType: actor?.type || "system",
      actorId: actor?.id || "system",
      actorName: actor?.name,
      resourceType: "tenant",
      resourceId: tenant.tenantId,
      resourceName: tenant.businessName,
      description: `Tenant deleted: ${tenant.businessName}`,
      metadata: {
        payload: { tenantId, status: "deleted" },
      },
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
    const updateData =
      this.credentialService.prepareEncryptedCredentials(credentials);

    const updatedTenant = await this.tenantRepo.updateFIRSCredentials(
      tenantId,
      updateData,
    );

    this.credentialService.invalidateCache(tenantId);

    await this.createAuditLog({
      tenantId: tenant.tenantId,
      eventType: AuditEventType.TENANT_UPDATED,
      severity: AuditEventSeverity.INFO,
      actorType: actor?.type || "system",
      actorId: actor?.id || "system",
      actorName: actor?.name,
      resourceType: "tenant",
      resourceId: tenant.tenantId,
      resourceName: tenant.businessName,
      description: `FIRS credentials updated for ${tenant.businessName}`,
      metadata: {
        payload: {
          certificateUpdated: !!updateData.certificate,
          publicKeyUpdated: !!updateData.publicKey,
          clientIdUpdated: !!updateData.clientId,
          businessId: updateData.businessId,
        },
      },
    });

    return updatedTenant!;
  }

  /**
   * Update tenant's business ID
   */
  async updateBusinessId(
    tenantId: string,
    businessId: string,
    actor?: any,
  ): Promise<TenantDocument> {
    const tenant = await this.getTenantById(tenantId);
    const encryptedClientId =
      this.credentialService.prepareEncryptedCredentials({
        clientId: businessId,
      });

    const updatedTenant = await this.tenantRepo.updateFIRSCredentials(
      tenantId,
      {
        clientId: encryptedClientId.clientId,
        businessId,
      },
    );

    this.credentialService.invalidateCache(tenantId);

    await this.createAuditLog({
      tenantId: tenant.tenantId,
      eventType: AuditEventType.TENANT_UPDATED,
      severity: AuditEventSeverity.INFO,
      actorType: actor?.type || "system",
      actorId: actor?.id || "system",
      actorName: actor?.name,
      resourceType: "tenant",
      resourceId: tenant.tenantId,
      resourceName: tenant.businessName,
      description: `Tenant business ID updated to ${businessId}`,
      metadata: {
        businessId,
        payload: { businessId },
      },
    });

    return updatedTenant!;
  }

  /**
   * Get decrypted FIRS credentials
   */
  async getFIRSCredentials(
    tenantId: string,
  ): Promise<DecryptedFIRSCredentials> {
    return this.credentialService.getFIRSCredentials(tenantId);
  }

  /**
   * API Key Management delegation
   */
  async createApiKey(
    tenantId: string,
    input: CreateApiKeyInput,
    actor?: any,
  ): Promise<{ apiKey: ApiKeyDTO; plainKey: string }> {
    const tenant = await this.getTenantById(tenantId);
    return this.apiKeyService.createApiKey(tenant, input, actor);
  }

  async listApiKeys(
    tenantId: string,
  ): Promise<{ data: ApiKeyDTO[]; meta: any }> {
    return this.apiKeyService.listApiKeys(tenantId);
  }

  async revokeApiKey(
    tenantId: string,
    keyId: string,
    reason?: string,
    actor?: any,
  ): Promise<void> {
    const tenant = await this.getTenantById(tenantId);
    return this.apiKeyService.revokeApiKey(tenant, keyId, reason, actor);
  }

  async rotateApiKey(
    tenantId: string,
    keyId: string,
    options?: { sendEmail?: boolean; reason?: string },
    actor?: any,
  ): Promise<{ apiKey: ApiKeyDTO; plainKey: string }> {
    const tenant = await this.getTenantById(tenantId);
    const result = await this.apiKeyService.rotateApiKey(
      tenant,
      keyId,
      options,
      actor,
    );

    if (options?.sendEmail !== false) {
      try {
        const emailContent: MailContent = {
          to: tenant.contactEmail,
          subject: "API Key Rotated - Action Required",
          html: withTemplate(
            templateEngine.render("apiKeyRotated", {
              businessName: tenant.businessName,
              oldKeyName: result.apiKey.name,
              plainKey: result.plainKey,
              newKeyName: result.apiKey.name,
              newKeyPrefix: result.apiKey.keyPrefix,
              created: new Date().toLocaleString(),
              expires: result.apiKey.expiresAt
                ? result.apiKey.expiresAt.toLocaleString()
                : undefined,
              reason: options?.reason,
            }),
          ),
        };
        await this.notifyTenant(emailContent, tenant);
      } catch (emailError: any) {
        logger.error("Failed to send API key rotation email", {
          tenantId,
          error: emailError.message,
        });
      }
    }

    return result;
  }

  async listAllApiKeys(filters?: {
    status?: string;
    tenantId?: string;
    skip?: number;
    limit?: number;
  }) {
    return this.apiKeyService.listAllApiKeys(filters);
  }

  /**
   * Onboarding delegation
   */
  async getOnboardingStatus(
    tenantId: string,
  ): Promise<TenantOnboardingDocument> {
    const tenant = await this.getTenantById(tenantId);
    return this.onboardingService.getOnboardingStatus(tenant);
  }

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
    return this.onboardingService.completeStep(tenant, step, actor);
  }

  async updateOnboarding(
    tenantId: string,
    input: UpdateOnboardingInput,
    actor?: any,
  ): Promise<TenantOnboardingDocument> {
    const tenant = await this.getTenantById(tenantId);
    const updated = await this.onboardingService.updateOnboarding(
      tenant,
      input as any,
      actor,
    );

    if (input.status === "active") {
      await this.activateTenant(tenantId, actor);
    }

    return updated;
  }

  async approveOnboarding(tenantId: string, actor?: any): Promise<void> {
    const tenant = await this.getTenantById(tenantId);
    await this.onboardingService.approveOnboarding(tenant, actor);
    await this.activateTenant(tenantId, actor);
  }

  async rejectOnboarding(
    tenantId: string,
    reason: string,
    actor?: any,
  ): Promise<void> {
    const tenant = await this.getTenantById(tenantId);
    return this.onboardingService.rejectOnboarding(tenant, reason, actor);
  }

  /**
   * ERP Sync Configuration delegation
   */
  async configureERPSync(
    tenantId: string,
    config: ERPSyncConfigInput,
    actor?: any,
  ): Promise<TenantDocument> {
    const tenant = await this.getTenantById(tenantId);
    return this.erpConfigService.configureERPSync(tenant, config, actor);
  }

  async getERPSyncConfig(tenantId: string): Promise<ERPSyncConfigInput | null> {
    const tenant = await this.getTenantById(tenantId);
    return this.erpConfigService.getDecryptedERPSyncConfig(tenant);
  }

  async listAllERPConfigs(filters?: {
    erpSystem?: string;
    enabled?: boolean;
    skip?: number;
    limit?: number;
  }) {
    return this.erpConfigService.listAllERPConfigs(filters);
  }

  /**
   * Activation & Auth Challenges delegation
   */
  getActivationTokenExpiry(tenant: any): Date | null {
    return this.authChallengeService.getActivationTokenExpiry(tenant);
  }

  isActivationTokenValid(tenant: any, decodedTokenId: string): boolean {
    return this.authChallengeService.isActivationTokenValid(
      tenant,
      decodedTokenId,
    );
  }

  isActivationTokenInTimeframe(tenant: any): boolean {
    return this.authChallengeService.isActivationTokenInTimeframe(tenant);
  }

  /**
   * Request email change verification
   */
  async requestEmailChange(
    tenantId: string,
    newEmail: string,
    actor?: any,
    currentPassword?: string,
  ): Promise<{ success: boolean; message: string }> {
    const tenant = await this.getTenantById(tenantId);
    const normalizedNewEmail = (newEmail || "").trim().toLowerCase();
    const oldEmail = (tenant.contactEmail || "").trim().toLowerCase();

    const isAdmin =
      actor?.isAdmin === true ||
      actor?.type === "system" ||
      actor?.role === "admin";

    if (!isAdmin && tenant.password) {
      if (!currentPassword) {
        throw new ValidationError(
          "Current password is required to request an email change",
        );
      }
      const isPasswordValid = await this.verifyHash(
        currentPassword,
        tenant.password,
      );
      if (!isPasswordValid) {
        throw new ValidationError("Invalid current password");
      }
    }

    if (!this.isValidEmail(normalizedNewEmail)) {
      throw new ValidationError("Invalid email address format");
    }

    if (normalizedNewEmail === oldEmail) {
      throw new ValidationError(
        "New email must be different from current contact email",
      );
    }

    const existing = await this.tenantRepo.findOne({
      contactEmail: { _eq: normalizedNewEmail },
      tenantId: { _ne: tenantId },
    });

    if (existing) {
      throw new ConflictError("Email is already in use by another tenant");
    }

    const rawTenant =
      typeof tenant.toObject === "function" ? tenant.toObject() : tenant;
    const verificationToken = await this.createAuthToken(
      {
        ...rawTenant,
        contactEmail: normalizedNewEmail,
        newEmail: normalizedNewEmail,
        previousEmail: oldEmail,
      },
      "12HRS",
    );

    const { verificationMail, securityAlertMail } =
      this.authChallengeService.buildEmailChangeMails(
        tenant,
        oldEmail,
        normalizedNewEmail,
        verificationToken,
      );

    await this.sendEmail(verificationMail);

    if (oldEmail && this.isValidEmail(oldEmail)) {
      this.sendEmail(securityAlertMail).catch((err) =>
        logger.warn("Failed to send security alert to old email", {
          tenantId,
          oldEmail,
          error: err.message,
        }),
      );
    }

    await this.createAuditLog({
      tenantId: tenant.tenantId,
      eventType: AuditEventType.TENANT_UPDATED,
      severity: AuditEventSeverity.INFO,
      actorType: actor?.type || "system",
      actorId: actor?.id || "system",
      actorName: actor?.name,
      resourceType: "tenant",
      resourceId: tenant.tenantId,
      resourceName: tenant.businessName,
      description: `Email change verification requested for ${normalizedNewEmail}`,
      metadata: {
        newEmail: normalizedNewEmail,
        oldEmail,
        action: "tenant.email_change_requested",
        payload: { newEmail: normalizedNewEmail },
      },
    });

    return {
      success: true,
      message: `Verification link sent to ${normalizedNewEmail}`,
    };
  }

  /**
   * Verify email change token and update contactEmail
   */
  async verifyEmailChange(
    tenantId: string,
    token: string,
    actor?: any,
  ): Promise<{
    success: boolean;
    contactEmail: string;
    message: string;
    tenant?: any;
  }> {
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

    const tokenTenantId = decoded.tenantId || decoded.sub;
    const newEmail = (
      decoded.newEmail ||
      decoded.contactEmail ||
      decoded.email ||
      ""
    )
      .trim()
      .toLowerCase();

    if (!newEmail) {
      throw new ValidationError(
        "Invalid verification token payload: missing new email",
      );
    }

    const targetTenantId = tenantId || tokenTenantId;
    const tenant = await this.getTenantById(targetTenantId);
    const oldEmail = (tenant.contactEmail || "").trim().toLowerCase();

    const existing = await this.tenantRepo.findOne({
      contactEmail: { _eq: newEmail },
      tenantId: { _ne: targetTenantId },
    });

    if (existing) {
      throw new ConflictError("Email is already in use by another tenant");
    }

    const updatedTenant = await this.tenantRepo.update(targetTenantId, {
      contactEmail: newEmail,
    });

    const successEmailContent: MailContent = {
      subject: "Contact Email Changed Successfully",
      html: withTemplate(
        templateEngine.render("emailChangeSuccessNotification", {
          businessName: tenant.businessName,
          oldEmail: oldEmail || "N/A",
          newEmail,
        }),
      ),
    };

    this.sendEmail({
      to: newEmail,
      subject: successEmailContent.subject,
      html: successEmailContent.html,
    }).catch((err) =>
      logger.warn("Failed to send email change confirmation to new email", {
        tenantId: targetTenantId,
        newEmail,
        error: err.message,
      }),
    );

    if (oldEmail && oldEmail !== newEmail && this.isValidEmail(oldEmail)) {
      this.sendEmail({
        to: oldEmail,
        subject: successEmailContent.subject,
        html: successEmailContent.html,
      }).catch((err) =>
        logger.warn("Failed to send email change confirmation to old email", {
          tenantId: targetTenantId,
          oldEmail,
          error: err.message,
        }),
      );
    }

    await this.createAuditLog({
      tenantId: tenant.tenantId,
      eventType: AuditEventType.TENANT_UPDATED,
      severity: AuditEventSeverity.INFO,
      actorType: actor?.type || "user",
      actorId: actor?.id || tenant.tenantId,
      actorName: actor?.name || tenant.businessName,
      resourceType: "tenant",
      resourceId: tenant.tenantId,
      resourceName: tenant.businessName,
      description: `Tenant contact email updated to ${newEmail} after verification`,
      metadata: {
        previousEmail: oldEmail,
        newEmail,
        payload: { targetTenantId, newEmail },
      },
    });

    return {
      success: true,
      contactEmail: newEmail,
      message: "Contact email updated successfully",
      tenant: this.sanitize(updatedTenant) as any,
    };
  }
}
