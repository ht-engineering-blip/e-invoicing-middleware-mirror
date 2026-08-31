import * as jwt from "jsonwebtoken";
import { appConfig, jwtConfig } from "../../../@config";
import { logger, BaseService, TIME_MS } from "../../../@lib";
import {
  AppError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../../../@lib/errors";
import { MailContent, withTemplate } from "../../../@lib/messaging";
import { TenantDocument, TenantStatus } from "../../tenants/models";
import { TenantRepository } from "../../tenants/repos/tenant.repo";
import { TeamMemberRepository } from "../../tenants/repos/team-member.repo";
import { TenantService } from "../../tenants/services/tenant.service";
import { AuditEventSeverity, AuditEventType } from "../../audit/models";
import { PasswordResetRepository } from "../repos/password-reset.repo";
import { templateEngine } from "../../../templates/engine";
import {
  FIRSService,
  FIRSUserInfoBusiness,
} from "../../../@lib/adapters/firs/firs.service";

export interface LoginResult {
  token: string;
  tokenType: string;
  expiresIn: string;
  tenant?: any;
  user?: any;
}

export class AuthService extends BaseService {
  private passwordResetRepo: PasswordResetRepository;
  private tenantRepo: TenantRepository;
  private teamMemberRepo: TeamMemberRepository;
  private tenantService: TenantService;
  private firsService: FIRSService;

  constructor(dependencies?: {
    passwordResetRepo?: PasswordResetRepository;
    tenantRepo?: TenantRepository;
    teamMemberRepo?: TeamMemberRepository;
    tenantService?: TenantService;
    firsService?: FIRSService;
  }) {
    super();
    this.passwordResetRepo =
      dependencies?.passwordResetRepo ?? new PasswordResetRepository();
    this.tenantRepo = dependencies?.tenantRepo ?? new TenantRepository();
    this.teamMemberRepo =
      dependencies?.teamMemberRepo ?? new TeamMemberRepository();
    this.tenantService = dependencies?.tenantService ?? new TenantService();
    this.firsService = dependencies?.firsService ?? new FIRSService();
  }

  /**
   * Tenant Login
   */
  async loginTenant(email: string, password: string): Promise<LoginResult> {
    logger.info("Tenant login attempt", { email });

    const tenant = await this.tenantService.getTenantByEmail(
      email,
      false,
      true,
    );

    if (!tenant) {
      throw new UnauthorizedError("Invalid credentials");
    }

    const isPasswordValid = await this.verifyHash(password, tenant?.password);
    if (!isPasswordValid) {
      throw new UnauthorizedError("Invalid credentials");
    }

    const token = await this.createAuthToken(tenant);

    logger.info("Tenant login successful", {
      tenantId: tenant._id,
      email,
    });

    return {
      token,
      tokenType: "Bearer",
      expiresIn: jwtConfig?.expiry || "24h",
      tenant: {
        id: tenant.tenantId,
        businessName: tenant.businessName,
        email: tenant.contactEmail,
        status: tenant.status,
      },
    };
  }

  /**
   * Team Member Login
   */
  async loginTeamMember(email: string, password: string): Promise<LoginResult> {
    logger.info("Team member login attempt", { email });

    const member = await this.teamMemberRepo.findByEmail(email);
    if (!member) {
      throw new UnauthorizedError("Invalid credentials");
    }

    if (member.status !== "active") {
      throw new UnauthorizedError(
        `Your account is ${member.status}. Please contact your administrator.`,
      );
    }

    if (!member.password) {
      throw new UnauthorizedError(
        "Account not fully activated. Please check your invitation email.",
      );
    }

    const isPasswordValid = await this.verifyHash(password, member.password);
    if (!isPasswordValid) {
      throw new UnauthorizedError("Invalid credentials");
    }

    const tenant = await this.tenantService.getTenantById(member.tenantId);

    const token = await this.createAuthToken({
      ...tenant,
      userId: member.userId,
      email: member.email,
      role: member.role,
      permissions: member.permissions || [],
      type: "team_member",
    });

    await this.createAuditLog({
      tenantId: tenant.tenantId,
      eventType: AuditEventType.TENANT_UPDATED,
      severity: AuditEventSeverity.INFO,
      actorType: "user",
      actorId: member.userId,
      actorName: `${member.firstName} ${member.lastName}`,
      resourceType: "team_member",
      resourceId: member.userId,
      resourceName: `${member.firstName} ${member.lastName}`,
      description: `Team member ${member.firstName} ${member.lastName} logged in`,
      metadata: {
        userId: member.userId,
        email: member.email,
        role: member.role,
      },
    });

    return {
      token,
      tokenType: "Bearer",
      expiresIn: jwtConfig?.expiry || "24h",
      user: {
        id: member.userId,
        email: member.email,
        firstName: member.firstName,
        lastName: member.lastName,
        role: member.role,
        permissions: member.permissions,
        tenantId: tenant.tenantId,
        businessName: tenant.businessName,
      },
    };
  }

  /**
   * FIRS OAuth Login
   */
  async loginFIRSOAuth(email: string, password: string): Promise<LoginResult> {
    logger.info("FIRS OAuth login attempt", { email });

    const authResult: any = await this.firsService.authenticate({
      email,
      password,
    });

    const businesses: FIRSUserInfoBusiness[] =
      authResult.data?.businesses || authResult?.businesses || [];
    if (!businesses.length) {
      throw new UnauthorizedError(
        "No business profile associated with this FIRS account",
      );
    }

    const business = businesses[0];
    const bName =
      (business as any).name || (business as any).legal_name || "Business";
    const bTin = business.tin || "";
    const bReg = (business as any).registration_number || "";

    let tenant = await this.tenantRepo.findByTIN(bTin);

    if (!tenant) {
      tenant = await this.tenantRepo.create({
        tenantId: this.tenantService.generateBusinessId(bName, bTin || "0000"),
        businessName: bName,
        tin: bTin,
        businessRegistrationNumber: bReg,
        contactEmail: email,
        status: TenantStatus.ACTIVE,
        config: { erpSystem: "custom" },
        metadata: { firsBusinessId: business.id },
      });
    }

    const token = await this.createAuthToken(tenant);

    return {
      token,
      tokenType: "Bearer",
      expiresIn: jwtConfig?.expiry || "24h",
      tenant: {
        id: tenant.tenantId,
        businessName: tenant.businessName,
        email: tenant.contactEmail,
        status: tenant.status,
      },
    };
  }

  /**
   * Set Password for Tenant
   */
  async setPassword(
    tenantId: string,
    newPassword: string,
    actor?: any,
  ): Promise<{ success: boolean; message: string }> {
    if (newPassword.length < 8) {
      throw new ValidationError("Password must be at least 8 characters long");
    }

    const tenant = await this.tenantRepo.findByTenantId(tenantId);
    if (!tenant) {
      throw new NotFoundError("Tenant not found");
    }

    const passwordHash = await this.hashString(newPassword);
    await this.tenantRepo.update(tenantId, {
      password: passwordHash,
      passwordChangedAt: new Date(),
    });

    await this.createAuditLog({
      tenantId: tenant.tenantId,
      eventType: AuditEventType.TENANT_UPDATED,
      severity: AuditEventSeverity.INFO,
      actorType: actor?.type || "user",
      actorId: actor?.id || tenantId,
      actorName: actor?.name || tenant.businessName,
      resourceType: "tenant",
      resourceId: tenant.tenantId,
      resourceName: tenant.businessName,
      description: `Password updated for ${tenant.businessName}`,
      metadata: { action: "auth.set_password" },
    });

    return {
      success: true,
      message: "Password set successfully",
    };
  }

  /**
   * Refresh Token
   */
  async refreshToken(
    currentToken: string,
  ): Promise<{ token: string; expiresIn: string }> {
    try {
      const decoded: any = jwt.verify(
        currentToken,
        jwtConfig?.secret || "default-secret",
        { algorithms: ["HS256"] },
      );

      let tenant: any;
      if (decoded.type === "team_member" && decoded.userId) {
        const member = await this.teamMemberRepo.findByUserId(decoded.userId);
        if (!member || member.status !== "active") {
          throw new UnauthorizedError("User is no longer active");
        }
        tenant = await this.tenantService.getTenantById(member.tenantId);
        const newToken = await this.createAuthToken({
          ...tenant,
          userId: member.userId,
          email: member.email,
          role: member.role,
          permissions: member.permissions || [],
          type: "team_member",
        });
        return { token: newToken, expiresIn: jwtConfig?.expiry || "24h" };
      }

      tenant = await this.tenantService.getTenantById(
        decoded.tenantId || decoded.sub,
      );
      const newToken = await this.createAuthToken(tenant);
      return { token: newToken, expiresIn: jwtConfig?.expiry || "24h" };
    } catch (err: any) {
      throw new UnauthorizedError("Invalid or expired token");
    }
  }

  /**
   * Request Password Reset
   */
  async requestPasswordReset(
    email: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const tenant = await this.tenantRepo.findOne({
        contactEmail: { _eq: email.toLowerCase() },
      });

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

      await this.passwordResetRepo.deleteByEmail(email);

      const { token: resetToken, hash: tokenHash } = this.generateToken(32);
      const expiresAt = new Date(Date.now() + TIME_MS.ONE_HOUR);

      await this.passwordResetRepo.create({
        tenantId: tenant.tenantId,
        email: email.toLowerCase(),
        tokenHash,
        expiresAt,
      });

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

      if (!record || record.expiresAt < new Date()) {
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
      if (newPassword.length < 8) {
        throw new ValidationError(
          "Password must be at least 8 characters long",
        );
      }

      const tokenHash = this.hashToken(token);
      const record = await this.passwordResetRepo.findByTokenHash(tokenHash);

      if (!record || record.expiresAt < new Date()) {
        throw new ValidationError("Invalid or expired reset token");
      }

      const tenant = await this.tenantRepo.findByTenantId(record.tenantId);
      if (!tenant) {
        throw new NotFoundError("Account not found");
      }

      const passwordHash = await this.hashString(newPassword);
      await this.tenantRepo.update(tenant.tenantId, {
        password: passwordHash,
        passwordChangedAt: new Date(),
      });

      await this.passwordResetRepo.markAsUsed(tokenHash);
      await this.passwordResetRepo.deleteByEmail(record.email);

      await this.sendPasswordChangedEmail(tenant);

      await this.createAuditLog({
        tenantId: tenant.tenantId,
        eventType: AuditEventType.TENANT_UPDATED,
        severity: AuditEventSeverity.INFO,
        actorType: "user",
        actorId: tenant.tenantId,
        actorName: tenant.businessName,
        resourceType: "tenant",
        resourceId: tenant.tenantId,
        resourceName: tenant.businessName,
        description: `Password reset successfully for ${tenant.businessName}`,
        metadata: {
          action: "auth.password_reset",
          email: record.email,
          payload: { email: record.email },
        },
      });

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

  private async sendPasswordResetEmail(
    tenant: TenantDocument,
    token: string,
    businessName: string,
  ): Promise<void> {
    try {
      const resetUrl = `${appConfig?.webAppURL || "http://localhost:3000"}/auth/reset-password?token=${token}`;

      const emailBody: MailContent = {
        to: tenant.contactEmail as string,
        subject: "Password Reset Request - E-Invoicing Platform",
        html: templateEngine.render("resetPassword", {
          businessName,
          resetUrl,
        }),
      };

      await this.sendEmail(emailBody);
      logger.info("Password reset email sent", { email: tenant.contactEmail });
    } catch (error: any) {
      logger.error("Failed to send password reset email", {
        email: tenant.contactEmail,
        error: error.message,
      });
    }
  }

  private async sendPasswordChangedEmail(
    tenant: TenantDocument,
  ): Promise<void> {
    try {
      const emailBody: MailContent = {
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
