import { TenantRepository } from "../../repos/tenant.repo";
import { NotFoundError } from "../../../../@lib/errors";
import { decryptSensitiveData, encryptSensitiveData } from "../../../../@lib/crypto";
import { TTLCache } from "../../../shared/utils";

export interface DecryptedFIRSCredentials {
  certificate?: string;
  publicKey?: string;
  clientId?: string;
}

export class TenantCredentialService {
  private tenantRepo: TenantRepository;
  // Cache decrypted credentials for 5 minutes to support 5000+ daily requests without DB decryption overhead
  private credentialCache = new TTLCache<string, DecryptedFIRSCredentials>({
    maxItems: 500,
    defaultTtlMs: 300_000,
  });

  constructor(tenantRepo?: TenantRepository) {
    this.tenantRepo = tenantRepo ?? new TenantRepository();
  }

  /**
   * Invalidate cached credentials for a tenant
   */
  invalidateCache(tenantId: string): void {
    this.credentialCache.delete(tenantId);
  }

  /**
   * Get decrypted FIRS credentials with high-performance memory caching
   */
  async getFIRSCredentials(
    tenantId: string,
  ): Promise<DecryptedFIRSCredentials> {
    const cached = this.credentialCache.get(tenantId);
    if (cached) return cached;

    const tenant = await this.tenantRepo.findOne({
      tenantId: { _eq: tenantId },
    });

    const firsCreds = tenant?.config?.firsCredentials;
    if (!tenant || (!firsCreds?.certificate && !firsCreds?.clientId)) {
      throw new NotFoundError("FIRS credentials not configured");
    }

    const result: DecryptedFIRSCredentials = {};

    if (firsCreds.certificate) {
      result.certificate = decryptSensitiveData(firsCreds.certificate);
    }
    if (firsCreds.publicKey) {
      result.publicKey = decryptSensitiveData(firsCreds.publicKey);
    }
    if (firsCreds.clientId) {
      result.clientId = decryptSensitiveData(firsCreds.clientId);
    }

    this.credentialCache.set(tenantId, result);
    return result;
  }

  /**
   * Prepare encrypted FIRS credentials payload for update
   */
  prepareEncryptedCredentials(credentials: {
    certificate?: string;
    publicKey?: string;
    clientId?: string;
    apiKey?: string;
    apiSecret?: string;
    serviceId?: string;
  }): Record<string, any> {
    const updateData: Record<string, any> = {
      serviceId: credentials.serviceId,
    };

    if (credentials.certificate && credentials.publicKey) {
      updateData.certificate = encryptSensitiveData(credentials.certificate);
      updateData.publicKey = encryptSensitiveData(credentials.publicKey);
    }

    if (credentials.clientId) {
      updateData.clientId = encryptSensitiveData(credentials.clientId);
      updateData.businessId = credentials.clientId;
    }
    if (credentials.apiKey) {
      updateData.apiKey = encryptSensitiveData(credentials.apiKey);
    }
    if (credentials.apiSecret) {
      updateData.apiSecret = encryptSensitiveData(credentials.apiSecret);
    }

    return updateData;
  }
}
