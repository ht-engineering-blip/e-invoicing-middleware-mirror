// Auth module routes
import { Elysia } from "elysia";
import * as jwt from "jsonwebtoken";
import { jwtConfig } from "../../@config";
import { logger } from "../../@lib";
import {
  FIRSService,
  FIRSUserInfoBusiness,
} from "../../@lib/adapters/firs/firs.service";
import { InternalServerError, UnauthorizedError, ValidationError } from "../../@lib/errors";
import { hashString, verifyHash } from "../../@lib/utils/encryption";
import { requireAuth } from "../../middlewares/auth";
import { TeamMemberService } from "../tenants/services/team-member.service";
import { TenantService } from "../tenants/services/tenant.service";
import { AuthService } from "./services";
import {
  loginRouteValidation,
  teamMemberLoginRouteValidation,
  firsOAuthRouteValidation,
  forgotPasswordRouteValidation,
  resetPasswordRouteValidation,
  validateResetTokenRouteValidation,
  meRouteValidation,
  setPasswordRouteValidation,
  refreshTokenRouteValidation,
} from "./validations/auth.validation";

/**
 * Auth Routes (public)
 */
const authRoutes = new Elysia()
  .decorate("tenantService", new TenantService())
  .decorate("firsService", new FIRSService())
  .decorate("authService", new AuthService())
  .decorate("teamMemberService", new TeamMemberService())

  /**
   * POST /auth
   * Login with email and password to get JWT token
   */
  .post(
    "/",
    async ({ body, tenantService, authService, set }) => {
      try {
        logger.info("Login attempt", { email: body.email });

        // Find tenant by contact email
        const tenant = await tenantService.getTenantByEmail(body.email, false, true);

        if (!tenant) {
          throw new UnauthorizedError("Invalid credentials");
        }




        // Verify password
        const isPasswordValid = await verifyHash(
          body.password,
          tenant?.password,
        );

        if (!isPasswordValid) {
          throw new UnauthorizedError("Invalid credentials");
        }

        console.log({ tenant });
        // Check if tenant is active
        /*   if (tenant.status !== 'active') {
          throw new UnauthorizedError('Tenant account is not active');
        } */

        // Generate JWT token
        let token = await authService.createAuthToken(tenant as any);

        logger.info("Login successful", {
          tenantId: tenant._id,
          email: body.email,
        });

        return {
          success: true,
          message: "Login successful",
          data: {
            token,
            tokenType: "Bearer",
            expiresIn: jwtConfig?.expiry || "24h",
            tenant: {
              id: tenant.tenantId,
              businessName: tenant.businessName,
              email: tenant.contactEmail,
              status: tenant.status,
            },
          },
        };
      } catch (error: any) {
        set.status = 401
        logger.error("Login failed", {
          email: body.email,
          error: error.message,
        });
        return {
          success: false,
          error: error.message || "Login failed",
          statusCode: error.statusCode || 401,
        };
      }
    },
    loginRouteValidation
  )

  /**
   * POST /auth/team-member
   * Login as a team member with email and password
   */
  .post(
    "/team-member",
    async ({ body, teamMemberService, set }) => {
      try {
        logger.info("Team member login attempt", { email: body.email });

        const result = await teamMemberService.loginTeamMember(
          body.email,
          body.password,
        );

        logger.info("Team member login successful", {
          tenantId: result.member.tenantId,
          userId: result.member.userId,
          email: body.email,
        });

        return {
          success: true,
          message: "Login successful",
          data: {
            token: result.authToken,
            tokenType: "Bearer",
            expiresIn: jwtConfig?.expiry || "24h",
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
        set.status = 400
        logger.error("Team member login failed", {
          email: body.email,
          error: error.message,
        });
        return {
          success: false,
          error: error.message || "Login failed",
          statusCode: 400,
        };
      }
    },
    teamMemberLoginRouteValidation
  )

  /**
   * POST /auth/oauth/firs
   * Authenticate with FIRS and sync credentials
   */
  .post(
    "/oauth/firs",
    async ({ body, tenantService, firsService, set }) => {
      try {
        logger.info("FIRS OAuth authentication request", {
          email: body.email,
          mock: body.mock,
        });

        let firsResult: { data: FIRSUserInfoBusiness };

        // Mock response for testing
        if (body.mock) {
          firsResult = {
            data: {
              id: "a6de8bd8-43be-47b9-80a5-988ee3fb9cea",
              reference: "enim-itaque",
              name: "Test Business Ltd",
              tin: "61392352-1056",
              sector: "Technology",
              annual_turnover: "above 100million",
              support_peppol: true,
              is_realtime_reporting: true,
              notification_channels: "email",
              erp_system: "SAP",
              irn_template: "{{invoice_id}}-34A843BE-{{YYYYMMDD}}",
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
          };
          try {
            firsResult = (await firsService.authenticate(credentials)) as {
              data: FIRSUserInfoBusiness;
            };
          } catch (firsError: any) {
            set.status = 401
            logger.error("FIRS API error", {
              status: firsError.message.response?.data?.code,
              message: firsError.message.response?.data?.data?.message,
            });
            throw new UnauthorizedError(
              firsError.message.response?.data?.data?.message ||
              firsError.response?.data?.message ||
              "FIRS authentication failed",
            );
          }
        }

        logger.info("FIRS OAuth successful", {
          businessName: firsResult.data.name,
          tin: firsResult.data.tin,
        });

        // Find tenant by TIN or email
        const tenant = await tenantService.getTenantByTinOrEmail(
          firsResult.data.tin,
        );

        // Update FIRS credentials if tenant exists
        if (tenant) {
          try {
            // Get service id from irn template
            let serviceId = firsResult.data.irn_template.split("-")[1];
            const credentials = {
              clientId: firsResult.data.id,
              serviceId,
            };

            await tenantService.updateFIRSCredentials(
              tenant.tenantId,
              credentials,
            );

            // Update tenant metadata with FIRS info
            await tenantService.updateTenant(tenant.tenantId, {
              businessName: firsResult.data.name,
            });

            logger.info("FIRS credentials updated for existing tenant", {
              tenantId: tenant.tenantId,
            });
          } catch (updateError: any) {
            logger.warn("Failed to update FIRS credentials", {
              error: updateError.message,
            });
          }
        } else {
          set.status = 400
          return {
            success: false,
            error: "Your TIN have not been registered on our system.",
            statusCode: 400,
          };
        }

        // Generate JWT token
        const tokenPayload = {
          tenantId: tenant.tenantId,
          businessId: (tenant as any).businessId || tenant.tenantId,
          email: tenant.contactEmail,
          businessName: tenant.businessName,
          type: "tenant",
        };

        const jwtSecret = jwtConfig?.secret;
        const jwtExpiry = jwtConfig?.expiry || "24h";
        const jwtAlgorithm = jwtConfig?.algorithm || "HS256";

        const token = jwt.sign(tokenPayload, jwtSecret!, {
          expiresIn: jwtExpiry as any,
          algorithm: jwtAlgorithm,
        });

        return {
          success: true,
          message: "FIRS authentication successful",
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
              ? "FIRS credentials synced with existing tenant"
              : "FIRS authenticated - tenant can be created",
          },
        };
      } catch (error: any) {
        set.status = 500
        logger.error("FIRS OAuth failed", { error: error.message });
        return {
          success: false,
          error: error.message || "FIRS authentication failed",
          statusCode: error.statusCode || 500,
        };
      }
    },
    firsOAuthRouteValidation
  )

  /**
   * POST /auth/forgot-password
   * Request password reset email
   */
  .post(
    "/forgot-password",
    async ({ body, authService, set }) => {
      try {
        logger.info("Password reset requested", { email: body.email });

        const result = await authService.requestPasswordReset(body.email);

        return {
          success: true,
          message: result.message,
        };
      } catch (error: any) {
        set.status = 500
        logger.error("Password reset request failed", {
          email: body.email,
          error: error.message,
        });
        return {
          success: false,
          error: error.message || "Failed to process password reset request",
          statusCode: error.statusCode || 500,
        };
      }
    },
    forgotPasswordRouteValidation
  )

  /**
   * POST /auth/reset-password
   * Reset password using token from email
   */
  .post(
    "/reset-password",
    async ({ body, authService, set }) => {
      try {
        logger.info("Password reset attempt");

        const result = await authService.resetPassword(
          body.token,
          body.password,
        );

        return {
          success: true,
          message: result.message,
        };
      } catch (error: any) {
        set.status = 400
        logger.error("Password reset failed", { error: error.message });
        return {
          success: false,
          error: error.message || "Failed to reset password",
          statusCode: error.statusCode || 400,
        };
      }
    },
    resetPasswordRouteValidation
  )

  /**
   * GET /auth/validate-reset-token/:token
   * Validate if a reset token is still valid
   */
  .get(
    "/validate-reset-token/:token",
    async ({ params, authService, set }) => {
      try {
        const result = await authService.validateResetToken(params.token);

        if (!result.valid) {
          set.status = 400
          return {
            success: false,
            error: "Invalid or expired reset token",
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
        set.status = 400
        return {
          success: false,
          error: error.message || "Failed to validate token",
          statusCode: error.statusCode || 400,
        };
      }
    },
    validateResetTokenRouteValidation
  );

/**
 * Protected Auth Routes (require authentication)
 */
const protectedAuthRoutes = new Elysia()
  .use(requireAuth)
  .decorate("tenantService", new TenantService())
  .decorate("authService", new AuthService())
  .decorate("teamMemberService", new TeamMemberService())

  /**
   * GET /auth/me
   * Get current authenticated user details (tenant or team member)
   */
  .get(
    "/me",
    async ({ auth, tenantService, teamMemberService, set }) => {
      try {
        if (!auth || !auth.tenantId) {
          throw new UnauthorizedError("Not authenticated");
        }

        console.log(auth);
        // Handle team member authentication
        if (auth.isTeamMember && auth.userId) {
          logger.info("Fetching team member details", {
            tenantId: auth.tenantId,
            userId: auth.userId,
          });

          const member = await teamMemberService.getTeamMember(
            auth.tenantId,
            auth.userId,
          );
          const tenant = await tenantService.getTenantById(auth.tenantId);

          return {
            success: true,
            data: {
              type: "team_member",
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
                erpSystem: tenant.erpSystem,
              },
            },
          };
        }

        // Handle regular tenant authentication
        logger.info("Fetching tenant details", { tenantId: auth.tenantId });

        // Get full tenant details
        const tenant = await tenantService.getTenantById(auth.tenantId);

        // Get onboarding status
        let onboarding = null;
        try {
          onboarding = await tenantService.getOnboardingStatus(auth.tenantId);
        } catch (onboardingError) {
          logger.warn("Could not fetch onboarding status", {
            tenantId: auth.tenantId,
          });
        }

        // Calculate onboarding progress
        let onboardingProgress = 0;
        if (onboarding?.steps) {
          const steps = onboarding.steps;
          const completedSteps = Object.values(steps).filter(
            (step: any) => step.completed,
          ).length;
          const totalSteps = Object.keys(steps).length;
          onboardingProgress = Math.round((completedSteps / totalSteps) * 100);
        }

        let showMeta = { ...(tenant.metadata || {}) };
        delete showMeta.webhookSecretHash;
        return {
          success: true,
          data: {
            type: "tenant",
            id: tenant.tenantId,
            businessName: tenant.businessName,
            tin: tenant.tin,
            contactEmail: tenant.contactEmail,
            contactPhone: tenant.contactPhone,
            erpSystem: tenant.erpSystem,
            status: tenant.status,
            createdAt: tenant.createdAt,
            config: {
              firs: {
                serviceId: tenant.config?.firsCredentials?.serviceId,
                clientId: tenant.config?.firsCredentials?.clientId,
                publicKey: tenant.config?.firsCredentials?.publicKey,
              },
              features: tenant.config?.features,
              limits: tenant.config?.limits,
              webhookUrl: tenant.config?.webhookUrl,
              webhookEnabled: tenant.config?.webhookEnabled,
              invoiceIdKey: tenant.config?.invoiceIdKey,
            },
            onboarding: onboarding
              ? {
                status: onboarding.status,
                progress: onboardingProgress,
                steps: onboarding.steps,
                approvedAt: onboarding.approvedAt,
              }
              : null,
            metadata: showMeta,
          },
        };
      } catch (error: any) {
        set.status = 500
        logger.error("Failed to fetch user details", {
          tenantId: auth?.tenantId,
          userId: auth?.userId,
          error: error.message,
        });
        return {
          success: false,
          error: error.message || "Failed to fetch user details",
          statusCode: error.statusCode || 500,
        };
      }
    },
    meRouteValidation
  )

  /**
   * POST /auth/set-password
   * Set Account Password
   */
  .post(
    "/set-password",
    async ({ auth, body, tenantService, authService, set }) => {
      try {
        if (!auth || !auth.tenantId) {
          throw new UnauthorizedError("Not authenticated");
        }

        const tenant = await tenantService.getTenantById(auth.tenantId);
        if (tenant.metadata?.activationCompleted) {
          throw new ValidationError("Account has already been activated. Password cannot be set again.");
        }

        let { password } = body;
        // Store hashed password
        let parsedPassword = await hashString(password);
        let updatedTenant = await tenantService.updateTenant(auth.tenantId, {
          password: parsedPassword,
          metadata: {
            activationCompleted: true,
          },
        });
        if (updatedTenant) {
          let authToken = await authService.createAuthToken(
            updatedTenant as any,
          );

          // Automatically update onboarding step - mark Registration as complete
          try {
            const onboarding = await tenantService.getOnboardingStatus(
              updatedTenant.tenantId,
            );
            if (onboarding && !onboarding.steps?.registration?.completed) {
              await tenantService.completeOnboardingStep(
                updatedTenant.tenantId,
                "registration",
              );

              // Update status to in_progress if still pending
              if (onboarding.status === "pending") {
                await tenantService.updateOnboarding(updatedTenant.tenantId, {
                  status: "in_progress",
                });
              }
            }
          } catch (onboardingError) {
            // Don't fail the main operation if onboarding update fails
            logger.warn("Failed to update onboarding status:", onboardingError);
          }

          return {
            success: true,
            message: "Account password set successfully",
            data: {
              token: authToken,
              tokenType: "Bearer",
              expiresIn: jwtConfig?.expiry || "24h",
            },
          };
        } else {
          throw new InternalServerError(
            "Unable to set your password, Please try again.",
          );
        }
      } catch (error: any) {
        set.status = 401
        return {
          success: false,
          error: error.message || "Token refresh failed",
          statusCode: error.statusCode || 401,
        };
      }
    },
    setPasswordRouteValidation
  )
  /**
   * POST /auth/refresh
   * Refresh JWT token
   */
  .post(
    "/refresh",
    async ({ auth, set }) => {
      try {
        if (!auth || !auth.tenantId) {
          throw new UnauthorizedError("Not authenticated");
        }

        // Generate new token with same payload
        const tokenPayload = {
          tenantId: auth.tenantId,
          businessId: auth.businessId,
          email: (auth as any).email,
          businessName: (auth as any).businessName,
          type: "tenant",
        };

        const jwtSecret = jwtConfig?.secret || '';
        const jwtExpiry = jwtConfig?.expiry || "24h";
        const jwtAlgorithm = (jwtConfig?.algorithm || "HS256") as jwt.Algorithm;

        const token = jwt.sign(tokenPayload, jwtSecret, {
          expiresIn: jwtExpiry as any,
          algorithm: jwtAlgorithm,
        });

        logger.info("Token refreshed", { tenantId: auth.tenantId });

        return {
          success: true,
          message: "Token refreshed successfully",
          data: {
            token,
            tokenType: "Bearer",
            expiresIn: jwtConfig?.expiry || "24h",
          },
        };
      } catch (error: any) {
        set.status = 401
        return {
          success: false,
          error: error.message || "Token refresh failed",
          statusCode: error.statusCode || 401,
        };
      }
    },
    refreshTokenRouteValidation
  );

/**
 * Auth Module Routes
 */
export const authModuleRoutes = new Elysia({ prefix: "/auth" })
  .use(authRoutes)
  .use(protectedAuthRoutes);
