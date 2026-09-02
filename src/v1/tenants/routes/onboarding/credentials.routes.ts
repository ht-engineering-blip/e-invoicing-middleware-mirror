import { Elysia } from "elysia";
import { firsConfig, appConfig } from "../../../../@config";
import { logger, ResponseBuilder, TIME_MS } from "../../../../@lib";
import { MailContent, withTemplate } from "../../../../@lib/messaging";
import { requireAuth, getActor } from "../../../../middlewares/auth";
import { onlySelf } from "../../../auth/utils/access-checks";
import { AuthService } from "../../../auth/services";
import { TenantService } from "../../services/tenant.service";
import { AuditService } from "../../../audit/services/audit.service";
import { AuditEventType, AuditEventSeverity } from "../../../audit/models";
import { templateEngine } from "../../../../templates/engine";
import {
  updateCredentialsValidation,
  updateBusinessIdValidation,
  resendTenantTokenValidation,
} from "../../validations/onboarding.validation";
import * as crypto from "crypto";

export const onboardingCredentialsRoutes = new Elysia()
  .use(requireAuth)
  .decorate("tenantService", new TenantService())
  .decorate("authService", new AuthService())
  .decorate("auditService", new AuditService())

  /**
   * PUT /tenants/:tenantId/credentials
   * Update tenant's public key and certificate
   */
  .put(
    "/:tenantId/credentials",
    async ({ params, body, auth, tenantService, set }) => {
      try {
        onlySelf(auth!, params.tenantId);

        logger.info("Updating tenant credentials", {
          tenantId: params.tenantId,
          mock: body?.mock,
        });

        const isMock = Boolean(body?.mock);

        let certificate = body?.certificate;
        let publicKey = body?.publicKey;

        if (isMock) {
          if (
            !certificate ||
            !certificate.includes("-----BEGIN CERTIFICATE-----")
          ) {
            certificate = firsConfig?.mockCertificate;
          }
          if (!publicKey || !publicKey.includes("-----BEGIN")) {
            publicKey = firsConfig?.mockPublicKey;
          }
        }

        const updatedTenant = await tenantService.updateFIRSCredentials(
          params.tenantId,
          {
            certificate,
            publicKey,
            serviceId: body.serviceId,
          },
          getActor(auth),
        );

        try {
          const onboarding = await tenantService.getOnboardingStatus(
            params.tenantId,
          );
          if (onboarding && !onboarding.steps?.firsProvisioning?.completed) {
            await tenantService.completeOnboardingStep(
              params.tenantId,
              "firsProvisioning",
              getActor(auth),
            );
          }
        } catch (onboardingError) {
          logger.warn("Failed to update onboarding step", {
            error: onboardingError,
          });
        }

        return ResponseBuilder.success(
          {
            tenantId: updatedTenant.tenantId,
            hasCredentials: true,
          },
          undefined,
          "Credentials updated successfully",
        );
      } catch (error: any) {
        set.status = error.statusCode || 500;
        logger.error("Failed to update credentials", { error: error.message });
        return ResponseBuilder.error(
          error.message || "Failed to update credentials",
          error.statusCode || 500,
        );
      }
    },
    updateCredentialsValidation,
  )

  /**
   * PUT /tenants/:tenantId/business-id
   * Update tenant's business ID
   */
  .put(
    "/:tenantId/business-id",
    async ({ params, body, auth, tenantService, set }) => {
      try {
        onlySelf(auth!, params.tenantId);

        logger.info("Updating tenant business ID", {
          tenantId: params.tenantId,
          businessId: body.businessId,
        });

        const updatedTenant = await tenantService.updateBusinessId(
          params.tenantId,
          body.businessId,
          getActor(auth),
        );

        return ResponseBuilder.success(
          {
            tenantId: updatedTenant.tenantId,
            businessId: body.businessId,
          },
          undefined,
          "Business ID updated successfully",
        );
      } catch (error: any) {
        set.status = error.statusCode || 500;
        logger.error("Failed to update business ID", { error: error.message });
        return ResponseBuilder.error(
          error.message || "Failed to update business ID",
          error.statusCode || 500,
        );
      }
    },
    updateBusinessIdValidation,
  )

  /**
   * POST /tenants/resend/token/:tenantId
   * Resend onboarding activation email
   */
  .post(
    "/resend/token/:tenantId",
    async ({ params, auth, tenantService, authService, auditService, set }) => {
      try {
        onlySelf(auth!, params.tenantId);

        logger.info("Resending activation email", {
          tenantId: params.tenantId,
        });

        const tenant = await tenantService.getTenantById(params.tenantId);

        if (!tenant) {
          set.status = 404;
          return ResponseBuilder.error("Tenant not found", 404);
        }

        if (tenant.password || tenant.metadata?.activationCompleted) {
          set.status = 400;
          return ResponseBuilder.error(
            "Account has already been activated",
            400,
          );
        }

        if (tenantService.isActivationTokenInTimeframe(tenant)) {
          logger.info("Disabling previous activation token", {
            tenantId: tenant.tenantId,
            tokenId: tenant.metadata?.activationTokenId,
          });
        }

        const activationTokenId = crypto.randomUUID();
        const activationTokenExpiresAt = new Date(
          Date.now() + TIME_MS.TWELVE_HOURS,
        );

        const metadata = {
          ...tenant.metadata,
          activationTokenId,
          activationTokenExpiresAt,
        };

        await tenantService.updateTenant(
          tenant.tenantId,
          { metadata },
          getActor(auth),
        );

        const isObject = typeof tenant.toObject === "function";
        const rawTenant = isObject ? tenant.toObject() : tenant;

        const activationToken = await authService.createAuthToken(
          {
            ...rawTenant,
            activationTokenId,
          } as any,
          "12HRS",
        );

        const activationLink = `${appConfig?.webAppURL}/auth/activate?_u=${activationToken}`;
        const activationEmail: MailContent = {
          subject: "Welcome to HT Invoicing",
          html: withTemplate(
            templateEngine.render("newTenants", { activationLink }),
          ),
        };
        await tenantService.notifyTenant(activationEmail, tenant);

        const route = `/tenants/resend/token/${params.tenantId}`;
        await auditService.createAuditLog({
          tenantId: tenant.tenantId,
          eventType: AuditEventType.TENANT_UPDATED,
          severity: AuditEventSeverity.INFO,
          actorType: auth?.isAdmin ? "user" : "tenant",
          actorId: auth?.userId || (auth?.isAdmin ? "admin" : params.tenantId),
          actorName:
            auth?.email || (auth?.isAdmin ? "Admin" : tenant.businessName),
          resourceType: "tenant_activation_token",
          resourceId: tenant.tenantId,
          resourceName: tenant.businessName,
          description: `Activation token resent for tenant ${tenant.businessName}`,
          metadata: {
            route,
            token: activationToken,
            activationTokenId,
            activationLink,
            contactEmail: tenant.contactEmail,
            businessName: tenant.businessName,
          },
        });

        return ResponseBuilder.success(
          undefined,
          undefined,
          "Activation email resent successfully",
        );
      } catch (error: any) {
        set.status = error.statusCode || 500;
        logger.error("Failed to resend activation email", {
          error: error.message,
        });
        return ResponseBuilder.error(
          error.message || "Failed to resend activation email",
          error.statusCode || 500,
        );
      }
    },
    resendTenantTokenValidation,
  );
