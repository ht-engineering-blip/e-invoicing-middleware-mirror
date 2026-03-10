// Auth module routes
import { Elysia, t } from 'elysia';
import { requireAuth } from '../../middlewares/auth';
import { logger } from '../../@lib';
import { TenantService } from '../tenants/services/tenant.service';
import { TeamMemberService } from '../tenants/services/team-member.service';
import { hashString } from '../../@lib/utils/encryption';
import { AppError, InternalServerError, UnauthorizedError, ValidationError } from '../../@lib/errors';
import { jwtConfig } from '../../@config';
import * as jwt from 'jsonwebtoken';
import axios from 'axios';
import { firsConfig } from '../../@config';
import { FIRSService, FIRSUserInfoBusiness } from '../../@lib/adapters/firs/firs.service';
import { AuthService } from './services';
 

/**
 * Login Request Validator
 */
const loginValidator = t.Object({
  email: t.String({ format: 'email' }),
  password: t.String({ minLength: 6 }),
});

/**
 * Login Request Validator
 */
const passwordValidator = t.Object({
  password: t.String({ minLength: 6 }),
});

/**
 * FIRS OAuth Request Validator
 */
const firsOAuthValidator = t.Object({
  email: t.String({ format: 'email' }),
  password: t.String({ minLength: 1 }),
  mock: t.Optional(t.Boolean()),
});

/**
 * Forgot Password Request Validator
 */
const forgotPasswordValidator = t.Object({
  email: t.String({ format: 'email' }),
});

/**
 * Reset Password Request Validator
 */
const resetPasswordValidator = t.Object({
  token: t.String({ minLength: 1 }),
  password: t.String({ minLength: 8 }),
});

/**
 * Auth Routes (public)
 */
const authRoutes = new Elysia()
  .decorate('tenantService', new TenantService())
  .decorate('firsService', new FIRSService())
  .decorate('authService', new AuthService())
  .decorate('teamMemberService', new TeamMemberService())

  /**
   * POST /auth
   * Login with email and password to get JWT token
   */
  .post(
    '/',
    async ({ body, tenantService, authService }) => {
      try {
        logger.info('Login attempt', { email: body.email });

        // Find tenant by contact email
        const tenant = await tenantService.getTenantByEmail(body.email);
     
        if (!tenant) {
          throw new UnauthorizedError('Invalid credentials');
        }

        // Verify password
        const passwordHash = hashString(body.password);
        const storedPasswordHash = (tenant as any)?.password;

        if (!storedPasswordHash || passwordHash !== storedPasswordHash) {
          throw new UnauthorizedError('Invalid credentials');
        }

        console.log({tenant})
        // Check if tenant is active
      /*   if (tenant.status !== 'active') {
          throw new UnauthorizedError('Tenant account is not active');
        } */

        // Generate JWT token
        let token = await authService.createAuthToken(tenant as any)

        logger.info('Login successful', {
          tenantId: tenant._id,
          email: body.email,
        });

        return {
          success: true,
          message: 'Login successful',
          data: {
            token,
            tokenType: 'Bearer',
            expiresIn: jwtConfig?.expiry || '24h',
            tenant: {
              id: tenant.tenantId,
              businessName: tenant.businessName,
              email: tenant.contactEmail,
              status: tenant.status,
            },
          },
        };
      } catch (error: any) {
        logger.error('Login failed', { email: body.email, error: error.message });
        return {
          success: false,
          error: error.message || 'Login failed',
          statusCode: error.statusCode || 401,
        };
      }
    },
    {
      body: loginValidator,
      detail: {
        tags: ['Authentication'],
        summary: 'Login',
        description: 'Login with email and password to receive a JWT token',
      },
    }
  )

  /**
   * POST /auth/team-member
   * Login as a team member with email and password
   */
  .post(
    '/team-member',
    async ({ body, teamMemberService }) => {
      try {
        logger.info('Team member login attempt', { email: body.email });

        const result = await teamMemberService.loginTeamMember(body.email, body.password);

        logger.info('Team member login successful', {
          tenantId: result.member.tenantId,
          userId: result.member.userId,
          email: body.email,
        });

        return {
          success: true,
          message: 'Login successful',
          data: {
            token: result.authToken,
            tokenType: 'Bearer',
            expiresIn: jwtConfig?.expiry || '24h',
            user: {
              userId: result.member.userId,
              tenantId: result.member.tenantId,
              email: result.member.email,
              firstName: result.member.firstName,
              lastName: result.member.lastName,
              role: result.member.role,
            },
          },
        };
      } catch (error: any) {
        logger.error('Team member login failed', { email: body.email, error: error.message });
        return {
          success: false,
          error: error.message || 'Login failed',
          statusCode: error.statusCode || 401,
        };
      }
    },
    {
      body: loginValidator,
      detail: {
        tags: ['Authentication'],
        summary: 'Team Member Login',
        description: 'Login as a team member with email and password',
      },
    }
  )

  /**
   * POST /auth/oauth/firs
   * Authenticate with FIRS and sync credentials
   */
  .post(
    '/oauth/firs',
    async ({ body, tenantService, firsService }) => {
      try {
        logger.info('FIRS OAuth authentication request', {
          email: body.email,
          mock: body.mock,
        });

        let firsResult: { data: FIRSUserInfoBusiness };

        // Mock response for testing
        if (body.mock) {
          firsResult = {
            data: {
              id: 'a6de8bd8-43be-47b9-80a5-988ee3fb9cea',
              reference: 'enim-itaque',
              name: 'Test Business Ltd',
              tin: '61392352-1056',
              sector: 'Technology',
              annual_turnover: 'above 100million',
              support_peppol: true,
              is_realtime_reporting: true,
              notification_channels: 'email',
              erp_system: 'SAP',
              irn_template: '{{invoice_id}}-34A843BE-{{YYYYMMDD}}',
              is_active: true,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          };
        } else {
          // FIRS OAuth call
          let credentials = {
            email: body.email,
            password: body.password,
          }
          try {
            firsResult = await firsService.authenticate(credentials) as { data: FIRSUserInfoBusiness };

          } catch (firsError: any) {
            logger.error('FIRS API error', {
              status: firsError.message.response?.data?.code,
              message: firsError.message.response?.data?.data?.message,
            });
            throw new UnauthorizedError(
              firsError.message.response?.data?.data?.message || firsError.response?.data?.message || 'FIRS authentication failed'
            );
          }
        }

        logger.info('FIRS OAuth successful', {
          businessName: firsResult.data.name,
          tin: firsResult.data.tin,
        });

        // Find tenant by TIN or email
        const tenant = await tenantService.getTenantByTinOrEmail(firsResult.data.tin);

        // Update FIRS credentials if tenant exists
        if (tenant) {
          try {
            // Get service id from irn template
            let serviceId = firsResult.data.irn_template.split("-")[1]
            const credentials = {
              clientId: firsResult.data.id,
              serviceId
            };

            await tenantService.updateFIRSCredentials(tenant.tenantId, credentials);

            // Update tenant metadata with FIRS info
            await tenantService.updateTenant(tenant.tenantId, {
              businessName: firsResult.data.name,
            });

            logger.info('FIRS credentials updated for existing tenant', {
              tenantId: tenant.tenantId,
            });
          } catch (updateError: any) {
            logger.warn('Failed to update FIRS credentials', {
              error: updateError.message,
            });
          }
        } else {
          return {
            success: false,
            error: 'Your TIN have not been registered on our system.',
            statusCode: 400,
          };
        }


         // Generate JWT token
        const tokenPayload = {
          tenantId: tenant.tenantId,
          businessId: (tenant as any).businessId || tenant.tenantId,
          email: tenant.contactEmail,
          businessName: tenant.businessName,
          type: 'tenant',
        };

        const jwtSecret = jwtConfig?.secret || 'default-secret-change-in-production';
        const jwtExpiry = jwtConfig?.expiry || '24h';
        const jwtAlgorithm = (jwtConfig?.algorithm || 'HS256') as jwt.Algorithm;

        const token = jwt.sign(tokenPayload, jwtSecret, {
          expiresIn: jwtExpiry as any,
          algorithm: jwtAlgorithm,
        });


        return {
          success: true,
          message: 'FIRS authentication successful',
          data: {
            business: {
              id: firsResult.data.id,
              name: firsResult.data.name,
              tin: firsResult.data.tin,
              sector: firsResult.data.sector,
              erpSystem: firsResult.data.erp_system,
              irnTemplate: firsResult.data.irn_template,
              isActive: firsResult.data.is_active,
            },
            token,
            tenantExists: !!tenant,
            tenantId: tenant?.tenantId,
            message: tenant
              ? 'FIRS credentials synced with existing tenant'
              : 'FIRS authenticated - tenant can be created',
          },
        };
      } catch (error: any) {
        logger.error('FIRS OAuth failed', { error: error.message });
        return {
          success: false,
          error: error.message || 'FIRS authentication failed',
          statusCode: error.statusCode || 500,
        };
      }
    },
    {
      body: firsOAuthValidator,
      detail: {
        tags: ['Authentication'],
        summary: 'FIRS OAuth',
        description: 'Authenticate with FIRS and optionally sync credentials to existing tenant',
      },
    }
  )

  /**
   * POST /auth/forgot-password
   * Request password reset email
   */
  .post(
    '/forgot-password',
    async ({ body, authService }) => {
      try {
        logger.info('Password reset requested', { email: body.email });

        const result = await authService.requestPasswordReset(body.email);

        return {
          success: true,
          message: result.message,
        };
      } catch (error: any) {
        logger.error('Password reset request failed', { email: body.email, error: error.message });
        return {
          success: false,
          error: error.message || 'Failed to process password reset request',
          statusCode: error.statusCode || 500,
        };
      }
    },
    {
      body: forgotPasswordValidator,
      detail: {
        tags: ['Authentication'],
        summary: 'Forgot Password',
        description: 'Request a password reset email',
      },
    }
  )

  /**
   * POST /auth/reset-password
   * Reset password using token from email
   */
  .post(
    '/reset-password',
    async ({ body, authService }) => {
      try {
        logger.info('Password reset attempt');

        const result = await authService.resetPassword(body.token, body.password);

        return {
          success: true,
          message: result.message,
        };
      } catch (error: any) {
        logger.error('Password reset failed', { error: error.message });
        return {
          success: false,
          error: error.message || 'Failed to reset password',
          statusCode: error.statusCode || 400,
        };
      }
    },
    {
      body: resetPasswordValidator,
      detail: {
        tags: ['Authentication'],
        summary: 'Reset Password',
        description: 'Reset password using the token received via email',
      },
    }
  )

  /**
   * GET /auth/validate-reset-token/:token
   * Validate if a reset token is still valid
   */
  .get(
    '/validate-reset-token/:token',
    async ({ params, authService }) => {
      try {
        const result = await authService.validateResetToken(params.token);

        if (!result.valid) {
          return {
            success: false,
            error: 'Invalid or expired reset token',
            statusCode: 400,
          };
        }

        return {
          success: true,
          data: {
            valid: true,
            email: result.email,
          },
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message || 'Failed to validate token',
          statusCode: error.statusCode || 400,
        };
      }
    },
    {
      params: t.Object({
        token: t.String(),
      }),
      detail: {
        tags: ['Authentication'],
        summary: 'Validate Reset Token',
        description: 'Check if a password reset token is still valid',
      },
    }
  );

/**
 * Protected Auth Routes (require authentication)
 */
const protectedAuthRoutes = new Elysia()
  .use(requireAuth)
  .decorate('tenantService', new TenantService())
  .decorate('authService', new AuthService())
  .decorate('teamMemberService', new TeamMemberService())

  /**
   * GET /auth/me
   * Get current authenticated user details (tenant or team member)
   */
  .get(
    '/me',
    async ({ auth, tenantService, teamMemberService }) => {
      try {
        if (!auth || !auth.tenantId) {
          throw new UnauthorizedError('Not authenticated');
        }

        console.log(auth)
        // Handle team member authentication
        if (auth.isTeamMember && auth.userId) {
          logger.info('Fetching team member details', {
            tenantId: auth.tenantId,
            userId: auth.userId
          });

          const member = await teamMemberService.getTeamMember(auth.tenantId, auth.userId);
          const tenant = await tenantService.getTenantById(auth.tenantId);

          return {
            success: true,
            data: {
              type: 'team_member',
              userId: member.userId,
              tenantId: member.tenantId,
              email: member.email,
              firstName: member.firstName,
              lastName: member.lastName,
              role: member.role,
              status: member.status,
              permissions: member.permissions,
              lastLoginAt: member.lastLoginAt,
              tenant: {
                id: tenant.tenantId,
                businessName: tenant.businessName,
                status: tenant.status,
              },
            },
          };
        }

        // Handle regular tenant authentication
        logger.info('Fetching tenant details', { tenantId: auth.tenantId });

        // Get full tenant details
        const tenant = await tenantService.getTenantById(auth.tenantId);

        // Get onboarding status
        let onboarding = null;
        try {
          onboarding = await tenantService.getOnboardingStatus(auth.tenantId);
        } catch (onboardingError) {
          logger.warn('Could not fetch onboarding status', {
            tenantId: auth.tenantId,
          });
        }

        // Calculate onboarding progress
        let onboardingProgress = 0;
        if (onboarding?.steps) {
          const steps = onboarding.steps;
          const completedSteps = Object.values(steps).filter(
            (step: any) => step.completed
          ).length;
          const totalSteps = Object.keys(steps).length;
          onboardingProgress = Math.round((completedSteps / totalSteps) * 100);
        }

        let showMeta = {...(tenant.metadata || {})}
        delete showMeta.webhookSecretHash
        return {
          success: true,
          data: {
            type: 'tenant',
            id: tenant.tenantId,
            businessName: tenant.businessName,
            tin: (tenant as any).tin,
            contactEmail: tenant.contactEmail,
            contactPhone: tenant.contactPhone,
            erpSystem: (tenant as any).erpSystem,
            status: tenant.status,
            createdAt: tenant.createdAt,
            config: {
              firs: {
                serviceId: (tenant as any).config?.firsCredentials?.serviceId,
                clientId: (tenant as any).config?.firsCredentials?.clientId,
                publicKey: (tenant as any).config?.firsCredentials?.publicKey,
              },
              features: (tenant as any).config?.features,
              limits: (tenant as any).config?.limits,
              webhookUrl: (tenant as any).config?.webhookUrl,
              webhookEnabled: (tenant as any).config?.webhookEnabled,
            },
            onboarding: onboarding
              ? {
                status: onboarding.status,
                progress: onboardingProgress,
                steps: onboarding.steps,
                approvedAt: onboarding.approvedAt,
              }
              : null,
              metadata: showMeta
          },
        };
      } catch (error: any) {
        logger.error('Failed to fetch user details', {
          tenantId: auth?.tenantId,
          userId: auth?.userId,
          error: error.message,
        });
        return {
          success: false,
          error: error.message || 'Failed to fetch user details',
          statusCode: error.statusCode || 500,
        };
      }
    },
    {
      detail: {
        tags: ['Authentication', 'Tenant'],
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        summary: 'Me',
        description: 'Get authenticated user details (tenant or team member)',
      },
    }
  )

  /**
   * POST /auth/set-password
   * Set Account Password
   */
  .post(
    '/set-password',
    async ({ auth, body, tenantService, authService }) => {
      try {
        if (!auth || !auth.tenantId) {
          throw new UnauthorizedError('Not authenticated');
        }
        let {password}=body
       // Store hashed password  
       let parsedPassword = hashString(password)
       let updatedTenant = await tenantService.updateTenant(auth.tenantId, {password: parsedPassword})
       if(updatedTenant){
        let authToken = await authService.createAuthToken(updatedTenant as any)
 
         // Automatically update onboarding step - mark Registration as complete
          try {
            const onboarding = await tenantService.getOnboardingStatus(updatedTenant.tenantId);
            if (onboarding && !onboarding.steps?.registration?.completed) {
              await tenantService.completeOnboardingStep(updatedTenant.tenantId, 'registration');

              // Update status to in_progress if still pending
              if (onboarding.status === 'pending') {
                await tenantService.updateOnboarding(updatedTenant.tenantId, {
                  status: 'in_progress',
                });
              }
            }
          } catch (onboardingError) {
            // Don't fail the main operation if onboarding update fails
            logger.warn('Failed to update onboarding status:', onboardingError);
          }

         return {
          success: true,
          message: 'Account password set successfully',
          data: {
            token: authToken,
            tokenType: 'Bearer',
            expiresIn: jwtConfig?.expiry || '24h',
          },
        };
       }else {
        throw new InternalServerError("Unable to set your password, Please try again.")
       }
      
      } catch (error: any) {
        return {
          success: false,
          error: error.message || 'Token refresh failed',
          statusCode: error.statusCode || 401,
        };
      }
    },
    {
      body: passwordValidator,
      detail: {
        tags: ['Authentication', 'Tenant'],
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        summary: 'Set Password',
        description: 'Set password using temporary auth token',
      },
    }
  )
  /**
   * POST /auth/refresh
   * Refresh JWT token
   */
  .post(
    '/refresh',
    async ({ auth }) => {
      try {
        if (!auth || !auth.tenantId) {
          throw new UnauthorizedError('Not authenticated');
        }

        // Generate new token with same payload
        const tokenPayload = {
          tenantId: auth.tenantId,
          businessId: auth.businessId,
          email: (auth as any).email,
          businessName: (auth as any).businessName,
          type: 'tenant',
        };

        const jwtSecret = jwtConfig?.secret || 'default-secret-change-in-production';
        const jwtExpiry = jwtConfig?.expiry || '24h';
        const jwtAlgorithm = (jwtConfig?.algorithm || 'HS256') as jwt.Algorithm;

        const token = jwt.sign(tokenPayload, jwtSecret, {
          expiresIn: jwtExpiry as any,
          algorithm: jwtAlgorithm,
        });

        logger.info('Token refreshed', { tenantId: auth.tenantId });

        return {
          success: true,
          message: 'Token refreshed successfully',
          data: {
            token,
            tokenType: 'Bearer',
            expiresIn: jwtConfig?.expiry || '24h',
          },
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message || 'Token refresh failed',
          statusCode: error.statusCode || 401,
        };
      }
    },
    {
      detail: {
        tags: ['Authentication'],
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        summary: 'Refresh token',
        description: 'Refresh JWT token to extend session',
      },
    }
  )

/**
 * Auth Module Routes
 */
export const authModuleRoutes = new Elysia({ prefix: '/auth' })
  .use(authRoutes)
  .use(protectedAuthRoutes);
