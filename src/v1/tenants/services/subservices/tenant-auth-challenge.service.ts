import * as jwt from "jsonwebtoken";
import { jwtConfig, appConfig } from "../../../../@config";
import { ValidationError } from "../../../../@lib/errors";
import { MailContent, withTemplate } from "../../../../@lib/messaging";
import { templateEngine } from "../../../../templates/engine";
import { type TenantDocument } from "../../models";
import { BaseService } from "../../../../@lib";

export class TenantAuthChallengeService extends BaseService {
  /**
   * Get the activation token expiration date without using ternary operators.
   */
  getActivationTokenExpiry(tenant: any): Date | null {
    if (
      !tenant ||
      !tenant.metadata ||
      !tenant.metadata.activationTokenExpiresAt
    ) {
      return null;
    }
    return new Date(tenant.metadata.activationTokenExpiresAt);
  }

  /**
   * Checks if an activation token is valid based on its ID and expiration date.
   */
  isActivationTokenValid(tenant: any, decodedTokenId: string): boolean {
    if (!tenant || !tenant.metadata || !tenant.metadata.activationTokenId) {
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
    return expiresAt >= now;
  }

  /**
   * Checks if the activation token is still within its valid timeframe (not expired)
   */
  isActivationTokenInTimeframe(tenant: any): boolean {
    if (!tenant || !tenant.metadata || !tenant.metadata.activationTokenId) {
      return false;
    }
    const expiresAt = this.getActivationTokenExpiry(tenant);
    if (!expiresAt) {
      return false;
    }
    const now = new Date();
    return expiresAt > now;
  }

  /**
   * Build email change token
   */
  generateEmailChangeToken(
    tenantId: string,
    oldEmail: string,
    newEmail: string,
  ): string {
    return jwt.sign(
      {
        sub: tenantId,
        oldEmail,
        newEmail,
        type: "email_change_verification",
      },
      jwtConfig?.secret || "default-secret",
      { expiresIn: "12h" },
    );
  }

  /**
   * Build email change verification emails
   */
  buildEmailChangeMails(
    tenant: TenantDocument,
    oldEmail: string,
    newEmail: string,
    verificationToken: string,
  ): { verificationMail: MailContent; securityAlertMail: MailContent } {
    const webAppUrl = appConfig?.webAppURL || "http://localhost:3000";
    const verificationLink = `${webAppUrl}/auth/verify-email?_u=${verificationToken}`;

    const verificationMail: MailContent = {
      to: newEmail,
      subject: "Verify your new email address",
      html: withTemplate(
        templateEngine.render("verifyEmailChange", {
          businessName: tenant.businessName,
          newEmail,
          verificationLink,
        }),
      ),
    };

    const securityAlertMail: MailContent = {
      to: oldEmail,
      subject: "Security Alert: Contact Email Change Requested",
      html: withTemplate(
        templateEngine.render("emailChangeAlertOldEmail", {
          businessName: tenant.businessName,
          oldEmail,
          newEmail,
        }),
      ),
    };

    return { verificationMail, securityAlertMail };
  }
}
