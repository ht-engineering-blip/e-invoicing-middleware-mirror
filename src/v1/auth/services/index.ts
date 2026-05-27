import { appConfig } from "../../../@config";
import { logger, BaseService } from "../../../@lib";
import { AppError, NotFoundError, ValidationError } from "../../../@lib/errors";
import { MailContent, withTemplate } from "../../../@lib/messaging";
import { TeamMemberRole, TenantDocument } from "../../tenants/models";
import { TenantRepository } from "../../tenants/repos/tenant.repo";
import { TenantService } from "../../tenants/services/tenant.service";
import { PasswordResetRepository } from "../repos/password-reset.repo";
import { templateEngine } from "../../../templates/engine";

export class AuthService extends BaseService {
  private passwordResetRepo: PasswordResetRepository;
  private tenantRepo: TenantRepository;

  constructor() {
    super();
    this.passwordResetRepo = new PasswordResetRepository();
    this.tenantRepo = new TenantRepository();
  }


  /**
   * Request Password Reset
   * Generates a reset token and sends email to the user
   */
  async requestPasswordReset(
    email: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      // Find tenant by email
      const tenant = await this.tenantRepo.findOne({
        contactEmail: { _eq: email.toLowerCase() },
      });

      // Always return success to prevent email enumeration
      if (!tenant) {
        logger.info("Password reset requested for non-existent email", {
          email,
        });
        return {
          success: true,
          message:
            "If an account exists with this email, a password reset link has been sent.",
        };
      }

      // Delete any existing reset tokens for this email
      await this.passwordResetRepo.deleteByEmail(email);

      // Generate reset token (32 bytes = 64 hex characters)
      const { token: resetToken, hash: tokenHash } = this.generateToken(32);

      // Token expires in 1 hour
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

      // Save token hash to database
      await this.passwordResetRepo.create({
        tenantId: tenant.tenantId,
        email: email.toLowerCase(),
        tokenHash,
        expiresAt,
      });

      // Send reset email
      await this.sendPasswordResetEmail(
        tenant,
        resetToken,
        tenant.businessName,
      );

      logger.info("Password reset token created", {
        email,
        tenantId: tenant.tenantId,
      });

      return {
        success: true,
        message:
          "If an account exists with this email, a password reset link has been sent.",
      };
    } catch (error: any) {
      logger.error("Error requesting password reset", {
        email,
        error: error.message,
      });
      throw new AppError(500, "Failed to process password reset request");
    }
  }

  /**
   * Validate Reset Token
   */
  async validateResetToken(
    token: string,
  ): Promise<{ valid: boolean; email?: string }> {
    try {
      const tokenHash = this.hashToken(token);
      const record = await this.passwordResetRepo.findByTokenHash(tokenHash);

      if (!record) {
        return { valid: false };
      }

      if (record.expiresAt < new Date()) {
        return { valid: false };
      }

      return { valid: true, email: record.email };
    } catch (error: any) {
      logger.error("Error validating reset token", { error: error.message });
      return { valid: false };
    }
  }

  /**
   * Reset Password with Token
   */
  async resetPassword(
    token: string,
    newPassword: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      // Validate password strength
      if (newPassword.length < 8) {
        throw new ValidationError(
          "Password must be at least 8 characters long",
        );
      }

      // Find and validate token
      const tokenHash = this.hashToken(token);
      const record = await this.passwordResetRepo.findByTokenHash(tokenHash);

      if (!record) {
        throw new ValidationError("Invalid or expired reset token");
      }

      if (record.expiresAt < new Date()) {
        throw new ValidationError("Reset token has expired");
      }

      // Find tenant
      const tenant = await this.tenantRepo.findByTenantId(record.tenantId);
      if (!tenant) {
        throw new NotFoundError("Account not found");
      }

      // Hash and save new password
      const passwordHash = await this.hashString(newPassword);
      await this.tenantRepo.update(tenant.tenantId, {
        password: passwordHash,
        passwordChangedAt: new Date(),
      });

      // Mark token as used
      await this.passwordResetRepo.markAsUsed(tokenHash);

      // Delete all reset tokens for this user (invalidate any other pending resets)
      await this.passwordResetRepo.deleteByEmail(record.email);

      // Send password changed notification
      await this.sendPasswordChangedEmail(tenant);

      logger.info("Password reset successful", { tenantId: tenant.tenantId });

      return {
        success: true,
        message:
          "Password has been reset successfully. You can now log in with your new password.",
      };
    } catch (error: any) {
      logger.error("Error resetting password", { error: error.message });
      if (error instanceof ValidationError || error instanceof NotFoundError) {
        throw error;
      }
      throw new AppError(500, "Failed to reset password");
    }
  }

  /**
   * Send Password Reset Email
   */
  private async sendPasswordResetEmail(
    tenant: TenantDocument,
    token: string,
    businessName: string,
  ): Promise<void> {
    try {
      const resetUrl = `${appConfig?.webAppURL || "http://localhost:3000"}/auth/reset-password?token=${token}`;

      let emailBody: MailContent = {
        to: tenant.contactEmail as string,
        subject: "Password Reset Request - E-Invoicing Platform",
        html: templateEngine.render("resetPassword", { businessName, resetUrl }),
      };

      await this.sendEmail(emailBody);

      logger.info("Password reset email sent", { email: tenant.contactEmail });
    } catch (error: any) {
      logger.error("Failed to send password reset email", {
        email: tenant.contactEmail,
        error: error.message,
      });
      // Don't throw - we don't want to reveal if email sending failed
    }
  }

  /**
   * Send Password Changed Notification Email
   */
  private async sendPasswordChangedEmail(
    tenant: TenantDocument,
  ): Promise<void> {
    try {
      let emailBody: MailContent = {
        to: tenant.contactEmail as string,
        subject: "Password Changed - E-Invoicing Platform",
        html: withTemplate(
          templateEngine.render("passwordChanged", {
            businessName: tenant.businessName,
          }),
        ),
      };
      await this.sendEmail(emailBody);

      logger.info("Password changed notification sent", {
        email: tenant.contactEmail,
      });
    } catch (error: any) {
      logger.error("Failed to send password changed notification", {
        email: tenant.contactEmail,
        error: error.message,
      });
    }
  }
}
