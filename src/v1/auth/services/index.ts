import * as crypto from "crypto";
import * as jwt from "jsonwebtoken";
import { appConfig, jwtConfig } from "../../../@config";
import { logger } from "../../../@lib";
import { AppError, NotFoundError, ValidationError } from "../../../@lib/errors";
import { MailContent } from "../../../@lib/messaging";
import { hashString } from "../../../@lib/utils/encryption";
import { TeamMemberRole, TenantDocument } from "../../tenants/models";
import { TenantRepository } from "../../tenants/repos/tenant.repo";
import { TenantService } from "../../tenants/services/tenant.service";
import { PasswordResetRepository } from "../repos/password-reset.repo";

export class AuthService {
  private passwordResetRepo: PasswordResetRepository;
  private tenantRepo: TenantRepository;

  constructor() {
    this.passwordResetRepo = new PasswordResetRepository();
    this.tenantRepo = new TenantRepository();
  }

  /**
   * Create Auth Token For Tenant
   */
  async createAuthToken(
    tenant: TenantDocument & { type: string; role: TeamMemberRole },
    expiresIn?: string,
  ): Promise<string> {
    const tokenPayload = {
      ...tenant,
      tenantId: tenant.tenantId,
      businessId: (tenant as any).businessId || tenant.tenantId,
      email: tenant.contactEmail,
      businessName: tenant.businessName,
      type: tenant.type || "tenant",
    };

    const jwtSecret = jwtConfig?.secret as string;
    const jwtExpiry = expiresIn || jwtConfig?.expiry;
    const jwtAlgorithm = jwtConfig?.algorithm as jwt.Algorithm;

    const token = jwt.sign(tokenPayload, jwtSecret, {
      expiresIn: jwtExpiry as any,
      algorithm: jwtAlgorithm,
    });

    return token;
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
      const resetToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto
        .createHash("sha256")
        .update(resetToken)
        .digest("hex");

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
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
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
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
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
      const passwordHash = await hashString(newPassword);
      await this.tenantRepo.update(tenant.tenantId, { password: passwordHash });

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
        subject: "Password Reset Request - E-Invoicing Platform",
        html: `
                    <h2>Password Reset Request</h2>
                    <p>Hello ${businessName},</p>
                    <p>We received a request to reset your password for your E-Invoicing account.</p>
                    <p>Click the link below to reset your password:</p>
                    <a href="${resetUrl}" style="display: inline-block; padding: 12px 24px; background-color: #007bff; color: white; text-decoration: none; border-radius: 4px;">Reset Password</a>
                    <p>This link will expire in 1 hour.</p>
                    <p>If you didn't request this password reset, please ignore this email or contact support if you have concerns.</p>
                    <br/>
                    <p>Best regards,<br/>E-Invoicing Platform Team</p>
                `,
      };

      await new TenantService().notifyTenant(emailBody, tenant);

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
        subject: "Password Changed - E-Invoicing Platform",
        html: `
                    <h2>Password Changed Successfully</h2>
                    <p>Hello ${tenant.businessName},</p>
                    <p>Your E-Invoicing account password has been changed successfully.</p>
                    <p>If you did not make this change, please contact support immediately.</p>
                    <br/>
                    <p>Best regards,<br/>E-Invoicing Platform Team</p>
                `,
      };
      await new TenantService().notifyTenant(emailBody, tenant);

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
