import { ApiKeyRepository } from "../../repos/api-key.repo";
import { TenantRepository } from "../../repos/tenant.repo";
import { NotFoundError } from "../../../../@lib/errors";
import { ApiKeyStatus, type TenantDocument } from "../../models";
import { AuditEventType, AuditEventSeverity } from "../../../audit/models";
import { BaseService } from "../../../../@lib";

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

export class TenantApiKeyService extends BaseService {
  private apiKeyRepo: ApiKeyRepository;
  private tenantRepo: TenantRepository;

  constructor(apiKeyRepo?: ApiKeyRepository, tenantRepo?: TenantRepository) {
    super();
    this.apiKeyRepo = apiKeyRepo ?? new ApiKeyRepository();
    this.tenantRepo = tenantRepo ?? new TenantRepository();
  }

  /**
   * Generate API key string
   */
  generateApiKey(): string {
    return `sk_${this.generateRandomString(32)}`;
  }

  /**
   * Create API key for tenant
   */
  async createApiKey(
    tenant: TenantDocument,
    input: { name: string; scopes?: string[]; expiresInDays?: number },
    actor?: any,
  ): Promise<{ apiKey: ApiKeyDTO; plainKey: string }> {
    const plainKey = this.generateApiKey();
    const keyHash = await this.hashString(plainKey);
    const keyPrefix = plainKey.substring(0, 8);

    const expiresAt = input.expiresInDays
      ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
      : undefined;

    const apiKey = await this.apiKeyRepo.create({
      tenantId: tenant.tenantId,
      name: input.name,
      keyHash,
      keyPrefix,
      scopes: input.scopes || [],
      expiresAt,
      status: ApiKeyStatus.ACTIVE,
    });

    await this.createAuditLog({
      tenantId: tenant.tenantId,
      eventType: AuditEventType.API_KEY_CREATED,
      severity: AuditEventSeverity.INFO,
      actorType: actor?.type || "system",
      actorId: actor?.id || "system",
      actorName: actor?.name || "System",
      resourceType: "api_key",
      resourceId: apiKey._id.toString(),
      resourceName: input.name,
      description: `API key created: ${input.name}`,
      metadata: {
        name: input.name,
        keyPrefix,
        scopes: input.scopes,
        expiresInDays: input.expiresInDays,
        payload: input,
      },
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
    tenant: TenantDocument,
    keyId: string,
    reason?: string,
    actor?: any,
  ): Promise<void> {
    const apiKey = await this.apiKeyRepo.findOne({ id: { _eq: keyId } });

    if (!apiKey || apiKey.tenantId !== tenant.tenantId) {
      throw new NotFoundError("API key");
    }

    await this.apiKeyRepo.revoke(keyId, actor?.id || "system", reason!);

    await this.createAuditLog({
      tenantId: tenant.tenantId,
      eventType: AuditEventType.API_KEY_REVOKED,
      severity: AuditEventSeverity.WARNING,
      actorType: actor?.type || "system",
      actorId: actor?.id || "system",
      actorName: actor?.name || "System",
      resourceType: "api_key",
      resourceId: keyId,
      resourceName: apiKey.name,
      description: `API key revoked${reason ? `: ${reason}` : ""}`,
      metadata: {
        reason,
        payload: { keyId, reason },
      },
    });
  }

  /**
   * Rotate API key
   */
  async rotateApiKey(
    tenant: TenantDocument,
    keyId: string,
    options?: { sendEmail?: boolean; reason?: string },
    actor?: any,
  ): Promise<{ apiKey: ApiKeyDTO; plainKey: string }> {
    const oldApiKey = await this.apiKeyRepo.findOne({ id: { _eq: keyId } });

    if (!oldApiKey || oldApiKey.tenantId !== tenant.tenantId) {
      throw new NotFoundError("API key");
    }

    await this.apiKeyRepo.revoke(
      keyId,
      actor?.id || "system",
      options?.reason || "API key rotated",
    );

    const { apiKey: newApiKey, plainKey } = await this.createApiKey(
      tenant,
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

    return { apiKey: newApiKey, plainKey };
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

    const apiKeyQuery: any = {};
    if (filters?.status) apiKeyQuery.status = { _eq: filters.status };
    if (filters?.tenantId) apiKeyQuery.tenantId = { _eq: filters.tenantId };

    const apiKeys = await this.apiKeyRepo.findMany(
      apiKeyQuery,
      undefined,
      limit,
      skip,
    );
    const total = await this.apiKeyRepo.count(apiKeyQuery);

    const tenantIds = [...new Set(apiKeys.map((key: any) => key.tenantId))];

    const tenants = await this.tenantRepo.findMany(
      { tenantId: { _in: tenantIds } },
      undefined,
      tenantIds.length,
      0,
    );

    const tenantMap = new Map(
      tenants.map((tenant: any) => [tenant.tenantId, tenant]),
    );

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
}
