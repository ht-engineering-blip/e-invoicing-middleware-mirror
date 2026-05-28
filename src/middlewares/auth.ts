import { Elysia } from 'elysia';
import crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import { appConfig } from '../@config/app';
import { jwtConfig } from '../@config/jwt';
import { UnauthorizedError } from '../@lib/errors';
import { ApiKeyRepository } from '../v1/tenants/repos/api-key.repo';
import { TenantRepository } from '../v1/tenants/repos/tenant.repo';
import { TeamMemberRepository } from '../v1/tenants/repos/team-member.repo';
import { TenantStatus, TeamMemberStatus } from '../v1/tenants/models';
import { decryptSensitiveData } from '../@lib/crypto';

// Ensure configs are defined
if (!appConfig) {
  throw new Error('App configuration is required');
}

if (!jwtConfig) {
  throw new Error('JWT configuration is required');
}

/**
 * Hash API key using SHA-256
 */
function hashApiKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

/**
 * Timing-safe comparison helper for sensitive keys
 */
function safeCompareKeys(input: any, expected: any): boolean {
  if (typeof input !== 'string' || typeof expected !== 'string') {
    return false;
  }
  const inputBuffer = Buffer.from(input);
  const expectedBuffer = Buffer.from(expected);

  if (inputBuffer.length !== expectedBuffer.length) {
    // Mitigate timing oracle for length differences
    crypto.timingSafeEqual(expectedBuffer, expectedBuffer);
    return false;
  }

  return crypto.timingSafeEqual(inputBuffer, expectedBuffer);
}

/**
 * Context interface for authenticated requests
 */
export interface AuthContext {
  tenantId: string;
  businessId?: string;
  businessName?: string;
  businessTIN?: string;
  tenantERP?: string;
  serviceId?: string;
  isAdmin: boolean;
  apiKeyId?: string;
  userId?: string;
  scopes?: string[];
  // Team member fields
  isTeamMember?: boolean;
  teamMemberRole?: string;
  email?: string;
}

/**
 * Admin authentication middleware
 * Validates admin key for tenant management operations
 */
export const requireAdmin = (instance: Elysia) => instance.resolve(
  async ({ headers }): Promise<{ auth: AuthContext }> => {
    const adminKey = headers['x-admin-key'];

    if (!adminKey) {
      throw new UnauthorizedError('Admin key is required');
    }

    if (!safeCompareKeys(adminKey, appConfig?.adminKey)) {
      throw new UnauthorizedError('Invalid admin key');
    }

    return {
      auth: {
        tenantId: 'system',
        isAdmin: true,
      },
    };
  }
);

/**
 * API Key authentication middleware
 * Validates API key and loads tenant context
 */
export const requireApiKey = (instance: Elysia) => instance.resolve(
  async ({ headers }): Promise<{ auth: AuthContext }> => {
    const apiKey = headers['x-api-key'];

    if (!apiKey) {
      throw new UnauthorizedError('API key is required');
    }

    // Hash the API key
    const keyHash = hashApiKey(apiKey);

    // Find API key in database
    const apiKeyRepo = new ApiKeyRepository();
    const apiKeyDoc = await apiKeyRepo.findByKeyHash(keyHash);

    if (!apiKeyDoc) {
      throw new UnauthorizedError('Invalid API key');
    }

    // Check if key is active
    if (apiKeyDoc.status !== 'active') {
      throw new UnauthorizedError(`API key is ${apiKeyDoc.status}`);
    }

    // Check if key is expired
    if (apiKeyDoc.expiresAt && apiKeyDoc.expiresAt < new Date()) {
      // Mark as expired (fire and forget)
      apiKeyRepo.revoke(apiKeyDoc._id.toString(), 'Expired', 'system').catch(() => { });
      throw new UnauthorizedError('API key has expired');
    }

    // Verify tenant is active
    const tenantRepo = new TenantRepository();
    const tenant = await tenantRepo.findByTenantId(apiKeyDoc.tenantId);

    if (!tenant) {
      throw new UnauthorizedError('Tenant not found');
    }

    if (tenant.status !== TenantStatus.ACTIVE && tenant.status !== TenantStatus.ONBOARDING) {
      throw new UnauthorizedError(`Tenant account is ${tenant.status}`);
    }

    // Update last used timestamp (fire and forget)
    apiKeyRepo.updateLastUsed(apiKeyDoc._id.toString()).catch((err) => {
      console.error('Failed to update API key last used:', err);
    });

    return {
      auth: {
        tenantId: apiKeyDoc.tenantId,
        isAdmin: false,
        apiKeyId: apiKeyDoc._id.toString(),
        scopes: apiKeyDoc.scopes || [],
      },
    };
  }
);

/**
 * JWT Token authentication middleware
 * Validates JWT token for user-based operations
 */
export const requireJwt = (instance: Elysia) => instance.resolve(
  async ({ headers }): Promise<{ auth: AuthContext }> => {
    const authHeader = headers['authorization'];

    if (!authHeader) {
      throw new UnauthorizedError('Authorization header is required');
    }

    if (!authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('Invalid authorization header format. Use: Bearer <token>');
    }

    const token = authHeader.substring(7);

    try {
      // Verify JWT token
      const decoded = jwt.verify(token, jwtConfig?.secret!, {
        algorithms: [jwtConfig?.algorithm as jwt.Algorithm],
      }) as any;

      // Validate required fields
      if (!decoded.tenantId || !decoded.businessId) {
        throw new UnauthorizedError('Invalid token payload');
      }

      // Verify tenant is active
      const tenantRepo = new TenantRepository();
      const tenant = await tenantRepo.findByTenantId(decoded.tenantId);

      if (!tenant) {
        throw new UnauthorizedError('Tenant not found');
      }

      if (tenant.status !== TenantStatus.ACTIVE && tenant.status !== TenantStatus.ONBOARDING) {
        throw new UnauthorizedError(`Tenant account is ${tenant.status}`);
      }

      if (tenant.passwordChangedAt && decoded.iat) {
        const iatMs = decoded.iat * 1000;
        if (iatMs < tenant.passwordChangedAt.getTime() - 1000) {
          throw new UnauthorizedError('Token has been invalidated due to password change');
        }
      }

      return {
        auth: {
          tenantId: decoded.tenantId,
          businessId: decoded.businessId,
          tenantERP: tenant.config?.erpSystem,
          isAdmin: false,
          userId: decoded.userId || decoded.sub,
          scopes: decoded.scopes || [],
        },
      };
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        throw new UnauthorizedError('Invalid token');
      }
      if (error instanceof jwt.TokenExpiredError) {
        throw new UnauthorizedError('Token has expired');
      }
      throw error;
    }
  }
);

/**
 * Flexible auth middleware that accepts either API key or JWT token
 * Useful for endpoints that support multiple auth methods
 */

export const requireAuth = async (instance: Elysia) => instance.resolve(
  async ({ headers, request }): Promise<{ auth: AuthContext }> => {
    const apiKey = headers['x-api-key'];
    const authHeader = headers['authorization'];
    const adminKey = headers['x-admin-key'];

    // Try Admin key first
    if (adminKey) {
      if (!safeCompareKeys(adminKey, appConfig?.adminKey)) {
        throw new UnauthorizedError('Invalid admin key');
      }

      return {
        auth: {
          tenantId: 'system',
          isAdmin: true,
        },
      };
    }
    // Try API key
    if (apiKey) {
      const keyHash = hashApiKey(apiKey);
      const apiKeyRepo = new ApiKeyRepository();
      const apiKeyDoc = await apiKeyRepo.findByKeyHash(keyHash);

      if (!apiKeyDoc) {
        throw new UnauthorizedError('Invalid API key');
      }

      if (apiKeyDoc.status !== 'active') {
        throw new UnauthorizedError(`API key is ${apiKeyDoc.status}`);
      }

      if (apiKeyDoc.expiresAt && apiKeyDoc.expiresAt < new Date()) {
        apiKeyRepo.revoke(apiKeyDoc._id.toString(), 'Expired', 'system').catch(() => { });
        throw new UnauthorizedError('API key has expired');
      }

      // Verify tenant
      const tenantRepo = new TenantRepository();
      const tenant = await tenantRepo.findByTenantId(apiKeyDoc.tenantId);

      if (!tenant || (tenant.status !== TenantStatus.ACTIVE && tenant.status !== TenantStatus.ONBOARDING)) {
        throw new UnauthorizedError(`Tenant account is ${tenant?.status || 'inactive'}`);
      }

      // Update last used
      apiKeyRepo.updateLastUsed(apiKeyDoc._id.toString()).catch((err) => {
        console.error('Failed to update API key last used:', err);
      });

      let decoded: any = {};
      // Decrypt Business ID
      if (tenant && tenant.config && tenant.config.firsCredentials?.clientId) {
        let decryptedClientID = decryptSensitiveData(tenant.config.firsCredentials.clientId)
        decoded.businessId = decryptedClientID
      }

      return {
        auth: {
          tenantId: apiKeyDoc.tenantId,
          businessId: decoded.businessId,
          businessName: tenant.businessName,
          businessTIN: tenant.tin,
          tenantERP: tenant.config?.erpSystem,
          serviceId: tenant?.config?.firsCredentials?.serviceId,
          isAdmin: false,
          apiKeyId: apiKeyDoc._id.toString(),
          scopes: apiKeyDoc.scopes || [],
        },
      };
    }

    // Try JWT token
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);

      try {
        const decoded = jwt.verify(token, jwtConfig?.secret!, {
          algorithms: [jwtConfig?.algorithm as jwt.Algorithm],
        }) as any;

        // Handle team member tokens
        if (decoded.type === 'team_member') {
          if (!decoded.tenantId || !decoded.userId) {
            throw new UnauthorizedError('Invalid team member token payload');
          }

          // Verify team member exists and is active
          const teamMemberRepo = new TeamMemberRepository();
          const teamMember = await teamMemberRepo.findByUserId(decoded.userId);

          if (!teamMember) {
            throw new UnauthorizedError('Team member not found');
          }

          if (teamMember.status !== TeamMemberStatus.ACTIVE) {
            throw new UnauthorizedError(`Team member account is ${teamMember.status}`);
          }

          if (teamMember.tenantId !== decoded.tenantId) {
            throw new UnauthorizedError('Invalid team member token');
          }

          // Verify tenant is active
          const tenantRepo = new TenantRepository();
          const tenant = await tenantRepo.findByTenantId(decoded.tenantId);

          if (!tenant || (tenant.status !== TenantStatus.ACTIVE && tenant.status !== TenantStatus.ONBOARDING)) {
            throw new UnauthorizedError(`Tenant account is ${tenant?.status || 'inactive'}`);
          }

          if (tenant.passwordChangedAt && decoded.iat) {
            const iatMs = decoded.iat * 1000;
            if (iatMs < tenant.passwordChangedAt.getTime() - 1000) {
              throw new UnauthorizedError('Token has been invalidated due to password change');
            }
          }

          // Get business ID from tenant config
          let businessId = decoded.businessId;
          if (tenant.config?.firsCredentials?.clientId) {
            businessId = decryptSensitiveData(tenant.config.firsCredentials.clientId);
          }

          return {
            auth: {
              tenantId: decoded.tenantId,
              businessId,
              businessName: tenant.businessName,
              businessTIN: tenant.tin,
              tenantERP: tenant.config?.erpSystem,
              serviceId: tenant?.config?.firsCredentials?.serviceId,
              isAdmin: false,
              userId: decoded.userId,
              email: teamMember.email,
              isTeamMember: true,
              teamMemberRole: teamMember.role,
              scopes: decoded.scopes || [],
            },
          };
        }

        // Handle set-password token 
        if (decoded?.purpose && decoded?.purpose == 'set-password') {
          const pathname = new URL(request.url).pathname;
          if (pathname !== '/auth/set-password' && pathname !== '/v1/auth/set-password') {
            throw new UnauthorizedError('set-password token is only authorized for setting password');
          }
          decoded.businessId = decoded.tenantId
        }
        // Handle regular tenant tokens
        if (!decoded.tenantId || !decoded.businessId) {
          throw new UnauthorizedError('Invalid token payload');
        }

        // Verify tenant
        const tenantRepo = new TenantRepository();
        const tenant = await tenantRepo.findByTenantId(decoded.tenantId);

        if (!tenant || (tenant.status !== TenantStatus.ACTIVE && tenant.status !== TenantStatus.ONBOARDING)) {
          throw new UnauthorizedError(`Tenant account is ${tenant?.status || 'inactive'}`);
        }

        if (tenant.passwordChangedAt && decoded.iat) {
          const iatMs = decoded.iat * 1000;
          if (iatMs < tenant.passwordChangedAt.getTime() - 1000) {
            throw new UnauthorizedError('Token has been invalidated due to password change');
          }
        }

        // Decrypt Business ID
        if (tenant && tenant.config && tenant.config.firsCredentials?.clientId) {
          let decryptedClientID = decryptSensitiveData(tenant.config.firsCredentials.clientId)
          decoded.businessId = decryptedClientID
        }
        return {
          auth: {
            tenantId: decoded.tenantId,
            businessId: decoded.businessId,
            businessName: tenant.businessName,
            businessTIN: tenant.tin,
            tenantERP: tenant.config?.erpSystem,
            serviceId: tenant?.config?.firsCredentials?.serviceId,
            isAdmin: false,
            userId: decoded.userId || decoded.sub,
            isTeamMember: false,
            scopes: decoded.scopes || [],
          },
        };
      } catch (error) {
        if (
          error instanceof jwt.JsonWebTokenError ||
          error instanceof jwt.TokenExpiredError
        ) {
          throw new UnauthorizedError('Invalid or expired token');
        }
        throw error;
      }
    }

    throw new UnauthorizedError('Authentication required. Provide x-admin-key, x-api-key or Authorization header');
  }
);

/**
 * Optional auth middleware - doesn't throw if no auth provided
 * Useful for public endpoints that have different behavior for authenticated users
 */
export const optionalAuth = (instance: Elysia) => instance.resolve(
  async ({ headers }): Promise<{ auth?: AuthContext }> => {
    const apiKey = headers['x-api-key'];
    const authHeader = headers['authorization'];

    // No auth provided
    if (!apiKey && !authHeader) {
      return { auth: undefined };
    }

    try {
      // Try API key
      if (apiKey) {
        const keyHash = hashApiKey(apiKey);
        const apiKeyRepo = new ApiKeyRepository();
        const apiKeyDoc = await apiKeyRepo.findByKeyHash(keyHash);

        if (apiKeyDoc && apiKeyDoc.status === 'active') {
          if (!apiKeyDoc.expiresAt || apiKeyDoc.expiresAt >= new Date()) {
            const tenantRepo = new TenantRepository();
            const tenant = await tenantRepo.findByTenantId(apiKeyDoc.tenantId);

            if (tenant && tenant.status === 'active') {
              apiKeyRepo.updateLastUsed(apiKeyDoc._id.toString()).catch(() => { });

              return {
                auth: {
                  tenantId: apiKeyDoc.tenantId,
                  isAdmin: false,
                  apiKeyId: apiKeyDoc._id.toString(),
                  scopes: apiKeyDoc.scopes || [],
                },
              };
            }
          }
        }
      }

      // Try JWT
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, jwtConfig?.secret!, {
          algorithms: [jwtConfig?.algorithm as jwt.Algorithm],
        }) as any;

        if (decoded.tenantId && decoded.businessId) {
          const tenantRepo = new TenantRepository();
          const tenant = await tenantRepo.findByTenantId(decoded.tenantId);

          if (tenant && tenant.status === 'active') {
            return {
              auth: {
                tenantId: decoded.tenantId,
                businessId: decoded.businessId,
                isAdmin: false,
                userId: decoded.userId || decoded.sub,
                scopes: decoded.scopes || [],
              },
            };
          }
        }
      }
    } catch (error) {
      // Silently fail for optional auth
      console.debug('Optional auth failed:', error);
    }

    return { auth: undefined };
  }
);

// Export hash function for use in other services
export { hashApiKey };
