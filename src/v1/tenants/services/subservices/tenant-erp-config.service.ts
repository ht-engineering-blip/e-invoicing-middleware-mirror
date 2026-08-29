import { TenantRepository } from "../../repos/tenant.repo";
import { ValidationError } from "../../../../@lib/errors";
import {
  encryptSensitiveData,
  decryptSensitiveData,
} from "../../../../@lib/crypto";
import { appConfig } from "../../../../@config";
import { isSafeUrl } from "../../../../@lib/utils/ssrf";
import { type TenantDocument } from "../../models";
import { AuditEventType, AuditEventSeverity } from "../../../audit/models";
import { BaseService } from "../../../../@lib";

export class TenantErpConfigService extends BaseService {
  private tenantRepo: TenantRepository;

  constructor(tenantRepo?: TenantRepository) {
    super();
    this.tenantRepo = tenantRepo ?? new TenantRepository();
  }

  /**
   * Configure ERP sync settings with SSRF safety checks and credential encryption
   */
  async configureERPSync(
    tenant: TenantDocument,
    config: ERPSyncConfigInput,
    actor?: any,
  ): Promise<TenantDocument> {
    if (config.baseUrl) {
      if (!(await isSafeUrl(config.baseUrl))) {
        throw new ValidationError(
          `ERP Sync baseUrl is blocked by SSRF guard: ${config.baseUrl}`,
        );
      }
    }
    if (config.endpoint && config.endpoint.startsWith("http")) {
      if (!(await isSafeUrl(config.endpoint))) {
        throw new ValidationError(
          `ERP Sync endpoint is blocked by SSRF guard: ${config.endpoint}`,
        );
      }
    }

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

    const updateData: any = {
      "config.erpSyncConfig": encryptedConfig,
    };

    const updatedTenant = await this.tenantRepo.update(
      tenant.tenantId,
      updateData,
    );

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
      description: `ERP sync configuration updated: ${config.name}`,
      metadata: {
        configName: config.name,
        method: config.method,
        endpoint: config.endpoint,
        enabled: config.enabled,
        action: "tenant.erp_sync_configured",
        payload: {
          name: config.name,
          method: config.method,
          endpoint: config.endpoint,
          enabled: config.enabled,
          headers: config.headers,
        },
      },
    });

    return updatedTenant!;
  }

  /**
   * Get ERP sync configuration with decrypted credentials
   */
  getDecryptedERPSyncConfig(tenant: TenantDocument): ERPSyncConfigInput | null {
    const tenantObj = (tenant as any).toObject
      ? (tenant as any).toObject({ flattenMaps: true })
      : JSON.parse(JSON.stringify(tenant));

    const config = tenantObj.config?.erpSyncConfig;
    if (!config) return null;

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

    const query: any = {};
    if (filters?.erpSystem) {
      query["config.erpSystem"] = { _eq: filters.erpSystem };
    }

    const tenants = await this.tenantRepo.findMany(
      query,
      undefined,
      limit,
      skip,
    );
    const total = await this.tenantRepo.count(query);

    const configs = tenants
      .map((tenant: any) => {
        const config = tenant.config;
        const erpSyncConfig = config?.erpSyncConfig;

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
      configs: configs as any,
      total: filters?.enabled !== undefined ? configs.length : total,
    };
  }
}
