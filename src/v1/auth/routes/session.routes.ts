import { Elysia } from "elysia";
import * as jwt from "jsonwebtoken";
import { jwtConfig } from "../../../@config";
import { logger, ResponseBuilder } from "../../../@lib";
import {
  InternalServerError,
  UnauthorizedError,
  ValidationError,
} from "../../../@lib/errors";
import { hashString } from "../../../@lib/utils/encryption";
import { requireAuth } from "../../../middlewares/auth";
import { TeamMemberRepository } from "../../tenants/repos/team-member.repo";
import { TenantService } from "../../tenants/services/tenant.service";
import { AuthService } from "../services";
import {
  meRouteValidation,
  setPasswordRouteValidation,
  refreshTokenRouteValidation,
} from "../validations/auth.validation";

export const authSessionRoutes = new Elysia()
  .use(requireAuth)
  .decorate("tenantService", new TenantService())
  .decorate("authService", new AuthService())
  .decorate("teamMemberRepo", new TeamMemberRepository())

  /**
   * GET /auth/me
   * Get current authenticated user / tenant profile
   */
  .get(
    "/me",
    async ({ auth, tenantService, teamMemberRepo, set }) => {
      try {
        if (!auth) {
          throw new UnauthorizedError("Not authenticated");
        }

        const isTeamMember = (auth as any)?.type === "team_member";

        if (isTeamMember) {
          if (!auth.userId) {
            throw new UnauthorizedError("Invalid team member authentication");
          }

          const member = await teamMemberRepo.findByUserId(auth.userId);
          if (!member) {
            throw new UnauthorizedError("Team member not found");
          }

          const tenant = await tenantService.getTenantById(auth.tenantId);

          return ResponseBuilder.success({
            type: "team_member",
            user: {
              id: member.userId,
              email: member.email,
              firstName: member.firstName,
              lastName: member.lastName,
              role: member.role,
              permissions: member.permissions,
              status: member.status,
              createdAt: member.createdAt,
              lastLoginAt: member.lastLoginAt,
            },
            tenant: {
              id: tenant.tenantId,
              businessName: tenant.businessName,
              status: tenant.status,
            },
          });
        }

        const tenant = await tenantService.getTenantById(auth.tenantId);
        const onboarding = await tenantService
          .getOnboardingStatus(auth.tenantId)
          .catch(() => null);

        let onboardingProgress = 0;
        if (onboarding?.steps) {
          const steps = Object.values(onboarding.steps);
          const completed = steps.filter((s: any) => s.completed).length;
          onboardingProgress = Math.round((completed / steps.length) * 100);
        }

        const showMeta = { ...tenant.metadata };
        delete showMeta.activationTokenId;
        delete showMeta.activationTokenExpiresAt;

        const tenantData = {
          id: tenant.tenantId,
          businessName: tenant.businessName,
          tin: tenant.tin,
          contactEmail: tenant.contactEmail,
          contactPhone: tenant.contactPhone,
          erpSystem: tenant.config?.erpSystem,
          status: tenant.status,
          createdAt: tenant.createdAt,
          config: {
            firs: {
              serviceId: tenant.config?.firsCredentials?.serviceId,
              clientId: "[REDACTED]",
              publicKey: "[REDACTED]",
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
        };

        return ResponseBuilder.success({
          type: "tenant",
          ...tenantData,
          tenant: tenantData,
        });
      } catch (error: any) {
        set.status = error.statusCode || 500;
        logger.error("Failed to fetch user details", {
          tenantId: auth?.tenantId,
          userId: auth?.userId,
          error: error.message,
        });
        return ResponseBuilder.error(
          error.message || "Failed to fetch user details",
          error.statusCode || 500,
        );
      }
    },
    meRouteValidation,
  )

  /**
   * POST /auth/set-password
   * Set Account Password with activation token clearance
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
          throw new ValidationError(
            "Account has already been activated. Password cannot be set again.",
          );
        }

        const parsedPassword = await hashString(body.password);
        const updatedTenant = await tenantService.updateTenant(auth.tenantId, {
          password: parsedPassword,
          metadata: {
            activationCompleted: true,
            activationTokenId: null,
            activationTokenExpiresAt: null,
          },
        });

        if (!updatedTenant) {
          throw new InternalServerError(
            "Unable to set your password, please try again.",
          );
        }

        const authToken = await authService.createAuthToken(
          updatedTenant as any,
        );

        try {
          const onboarding = await tenantService.getOnboardingStatus(
            updatedTenant.tenantId,
          );
          if (onboarding && !onboarding.steps?.registration?.completed) {
            await tenantService.completeOnboardingStep(
              updatedTenant.tenantId,
              "registration",
            );
            if (onboarding.status === "pending") {
              await tenantService.updateOnboarding(updatedTenant.tenantId, {
                status: "in_progress",
              });
            }
          }
        } catch (onboardingError) {
          logger.warn("Failed to update onboarding status:", onboardingError);
        }

        return ResponseBuilder.success(
          {
            token: authToken,
            tokenType: "Bearer",
            expiresIn: jwtConfig?.expiry || "24h",
          },
          undefined,
          "Account password set successfully",
        );
      } catch (error: any) {
        set.status = error.statusCode || 400;
        return ResponseBuilder.error(
          error.message || "Failed to set password",
          error.statusCode || 400,
        );
      }
    },
    setPasswordRouteValidation,
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

        const tokenPayload = {
          tenantId: auth.tenantId,
          businessId: auth.businessId,
          email: (auth as any).email,
          businessName: (auth as any).businessName,
          type: (auth as any).type || "tenant",
        };

        const jwtSecret = jwtConfig?.secret || "";
        const jwtExpiry = jwtConfig?.expiry || "24h";
        const jwtAlgorithm = (jwtConfig?.algorithm || "HS256") as jwt.Algorithm;

        const token = jwt.sign(tokenPayload, jwtSecret, {
          expiresIn: jwtExpiry as any,
          algorithm: jwtAlgorithm,
        });

        logger.info("Token refreshed", { tenantId: auth.tenantId });

        return ResponseBuilder.success(
          {
            token,
            tokenType: "Bearer",
            expiresIn: jwtConfig?.expiry || "24h",
          },
          undefined,
          "Token refreshed successfully",
        );
      } catch (error: any) {
        set.status = error.statusCode || 401;
        return ResponseBuilder.error(
          error.message || "Token refresh failed",
          error.statusCode || 401,
        );
      }
    },
    refreshTokenRouteValidation,
  );
