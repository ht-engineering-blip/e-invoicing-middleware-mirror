import * as crypto from "crypto";
import { appConfig } from "../../../@config";
import { BaseService, logger } from "../../../@lib";
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../../@lib/errors";
import {
  MailContent,
  withTemplate,
} from "../../../@lib/messaging";
import { templateEngine } from "../../../templates/engine";

import {
  TeamMemberDocument,
  TeamMemberRole,
  TeamMemberStatus,
} from "../models/team-member.model";
import { TeamMemberRepository } from "../repos/team-member.repo";
import { TenantRepository } from "../repos/tenant.repo";

export interface InviteTeamMemberInput {
  email: string;
  firstName: string;
  lastName: string;
  role: TeamMemberRole;
  permissions?: string[];
}

export interface UpdateTeamMemberInput {
  firstName?: string;
  lastName?: string;
  role?: TeamMemberRole;
  permissions?: string[];
  status?: TeamMemberStatus;
}

export class TeamMemberService extends BaseService {
  private teamMemberRepo: TeamMemberRepository;
  private tenantRepo: TenantRepository;

  constructor() {
    super();
    this.teamMemberRepo = new TeamMemberRepository();
    this.tenantRepo = new TenantRepository();
  }

  /**
   * Invite a new team member
   */
  async inviteTeamMember(
    tenantId: string,
    input: InviteTeamMemberInput,
    invitedBy: string,
  ): Promise<TeamMemberDocument> {
    try {
      // Check if tenant exists
      const tenant = await this.tenantRepo.findByTenantId(tenantId);
      if (!tenant) {
        throw new NotFoundError("Tenant not found");
      }

      // Check if email already exists in this tenant
      const existing = await this.teamMemberRepo.findByTenantAndEmail(
        tenantId,
        input.email,
      );
      if (existing) {
        throw new ConflictError("A team member with this email already exists");
      }

      // Cannot invite as owner
      if (input.role === TeamMemberRole.OWNER) {
        throw new ValidationError(
          "Cannot invite as owner. Use transfer ownership instead.",
        );
      }

      // Generate user ID and invitation token
      const userId = `usr_${crypto.randomBytes(12).toString("hex")}`;
      const invitationToken = crypto.randomBytes(32).toString("hex");

      // Create team member
      const teamMember = await this.teamMemberRepo.create({
        tenantId,
        userId,
        email: input.email.toLowerCase(),
        firstName: input.firstName,
        lastName: input.lastName,
        role: input.role,
        status: TeamMemberStatus.INVITED,
        invitationToken,
        invitedAt: new Date(),
        invitedBy,
        permissions: input.permissions || [],
      });

      // Send invitation email
      await this.sendInvitationEmail(
        teamMember,
        tenant.businessName,
        invitationToken,
      );

      logger.info("Team member invited", {
        tenantId,
        userId,
        email: input.email,
        invitedBy,
      });

      return teamMember;
    } catch (error: any) {
      logger.error("Failed to invite team member", { error: error.message });
      if (
        error instanceof NotFoundError ||
        error instanceof ConflictError ||
        error instanceof ValidationError
      ) {
        throw error;
      }
      throw new AppError(500, "Failed to invite team member");
    }
  }

  /**
   * Accept invitation and set password
   */
  async acceptInvitation(
    token: string,
    password: string,
  ): Promise<{ member: TeamMemberDocument; authToken: string }> {
    try {
      // Find member by invitation token
      const member = await this.teamMemberRepo.findByInvitationToken(token);
      if (!member) {
        throw new ValidationError("Invalid or expired invitation");
      }

      // Hash password
      const passwordHash = await this.hashString(password);

      // Update member
      const updatedMember = await this.teamMemberRepo.update(member.userId, {
        password: passwordHash,
        status: TeamMemberStatus.ACTIVE,
        acceptedAt: new Date(),
        invitationToken: undefined, // Clear token
      });

      if (!updatedMember) {
        throw new AppError(500, "Failed to accept invitation");
      }

      // Generate auth token
      // Generate JWT token
      let _tmpTenant: any = {
        tenantId: member.tenantId,
        userId: member.userId,
        email: member.email,
        role: member.role,
        type: "team_member",
      };
      let authToken = await this.createAuthToken(_tmpTenant);
      //const jwtSecret = jwtConfig?.secret as string;
      /*  const authToken = jwt.sign(
        {
          tenantId: member.tenantId,
          userId: member.userId,
          email: member.email,
          role: member.role,
          type: 'team_member',
        },
        jwtSecret,
        { expiresIn: jwtConfig?.expiry || '24h' }
      );
 */
      logger.info("Team member invitation accepted", {
        tenantId: member.tenantId,
        userId: member.userId,
      });

      return { member: updatedMember, authToken };
    } catch (error: any) {
      logger.error("Failed to accept invitation", { error: error.message });
      if (error instanceof ValidationError) throw error;
      throw new AppError(500, "Failed to accept invitation");
    }
  }

  /**
   * Login team member with email and password
   */
  async loginTeamMember(
    email: string,
    password: string,
  ): Promise<{ member: TeamMemberDocument; authToken: string }> {
    try {
      // Find team member by email
      const member = await this.teamMemberRepo.findByEmail(email.toLowerCase());

      if (!member) {
        throw new ValidationError("Invalid email or password");
      }

      // Check if member is active
      if (member.status !== TeamMemberStatus.ACTIVE) {
        if (member.status === TeamMemberStatus.INVITED) {
          throw new ValidationError("Please accept your invitation first");
        }
        throw new ValidationError(`Account is ${member.status}`);
      }

      // Verify password
      if (!member.password) {
        throw new ValidationError(
          "Password not set. Please reset your password.",
        );
      }

      const isPasswordValid = await this.verifyHash(password, member.password);
      if (!isPasswordValid) {
        throw new ValidationError("Invalid email or password");
      }

      // Get tenant for additional context
      const tenant = await this.tenantRepo.findByTenantId(member.tenantId);
      if (!tenant) {
        throw new ValidationError("Tenant not found");
      }

      // Generate auth token

      const _tmpTenant: any = {
        ...this.sanitize(tenant),
        userId: member.userId,
        email: member.email,
        role: member.role,
        type: "team_member",
        permissions: member.permissions,
      };
      const authToken = await this.createAuthToken(_tmpTenant);

      // Update last login
      await this.teamMemberRepo.update(member.userId, {
        lastLoginAt: new Date(),
      });

      logger.info("Team member logged in", {
        tenantId: member.tenantId,
        userId: member.userId,
        email: member.email,
      });

      return { member, authToken };
    } catch (error: any) {
      logger.error("Team member login failed", { email, error: error.message });
      if (error instanceof ValidationError) throw error;
      throw new AppError(500, "Login failed");
    }
  }

  /**
   * List team members for a tenant
   */
  async listTeamMembers(
    tenantId: string,
    options: {
      status?: TeamMemberStatus;
      role?: TeamMemberRole;
      page?: number;
      limit?: number;
    } = {},
  ): Promise<{ data: TeamMemberDocument[]; pagination: any }> {
    try {
      const page = options.page || 1;
      const limit = options.limit || 20;
      const offset = (page - 1) * limit;

      const result = await this.teamMemberRepo.findByTenant(tenantId, {
        status: options.status,
        role: options.role,
        limit,
        offset,
      });

      return {
        data: result.data,
        pagination: {
          page,
          limit,
          total: result.total,
          totalPages: Math.ceil(result.total / limit),
        },
      };
    } catch (error: any) {
      logger.error("Failed to list team members", { error: error.message });
      throw new AppError(500, "Failed to list team members");
    }
  }

  /**
   * Get a single team member
   */
  async getTeamMember(
    tenantId: string,
    userId: string,
  ): Promise<TeamMemberDocument> {
    try {
      const member = await this.teamMemberRepo.findByUserId(userId);

      if (!member || member.tenantId !== tenantId) {
        throw new NotFoundError("Team member not found");
      }

      return member;
    } catch (error: any) {
      if (error instanceof NotFoundError) throw error;
      logger.error("Failed to get team member", { error: error.message });
      throw new AppError(500, "Failed to get team member");
    }
  }

  /**
   * Update a team member
   */
  async updateTeamMember(
    tenantId: string,
    userId: string,
    input: UpdateTeamMemberInput,
    updatedBy: string,
  ): Promise<TeamMemberDocument> {
    try {
      const member = await this.getTeamMember(tenantId, userId);

      // Cannot change owner's role
      if (
        member.role === TeamMemberRole.OWNER &&
        input.role &&
        input.role !== TeamMemberRole.OWNER
      ) {
        throw new ForbiddenError(
          "Cannot change owner role. Transfer ownership first.",
        );
      }

      // Cannot promote to owner
      if (input.role === TeamMemberRole.OWNER) {
        throw new ForbiddenError(
          "Cannot promote to owner. Use transfer ownership.",
        );
      }

      // Cannot demote yourself
      if (userId === updatedBy && input.role && member.role !== input.role) {
        throw new ForbiddenError("Cannot change your own role");
      }

      const updatedMember = await this.teamMemberRepo.update(userId, {
        firstName: input.firstName,
        lastName: input.lastName,
        role: input.role,
        permissions: input.permissions,
        status: input.status,
      });

      if (!updatedMember) {
        throw new AppError(500, "Failed to update team member");
      }

      logger.info("Team member updated", { tenantId, userId, updatedBy });

      return updatedMember;
    } catch (error: any) {
      if (error instanceof NotFoundError || error instanceof ForbiddenError)
        throw error;
      logger.error("Failed to update team member", { error: error.message });
      throw new AppError(500, "Failed to update team member");
    }
  }

  /**
   * Remove a team member
   */
  async removeTeamMember(
    tenantId: string,
    userId: string,
    removedBy: string,
  ): Promise<void> {
    try {
      const member = await this.getTeamMember(tenantId, userId);

      // Cannot remove owner
      if (member.role === TeamMemberRole.OWNER) {
        throw new ForbiddenError("Cannot remove the tenant owner");
      }

      // Cannot remove yourself
      if (userId === removedBy) {
        throw new ForbiddenError("Cannot remove yourself");
      }

      await this.teamMemberRepo.delete(userId);

      logger.info("Team member removed", { tenantId, userId, removedBy });
    } catch (error: any) {
      if (error instanceof NotFoundError || error instanceof ForbiddenError)
        throw error;
      logger.error("Failed to remove team member", { error: error.message });
      throw new AppError(500, "Failed to remove team member");
    }
  }

  /**
   * Resend invitation email
   */
  async resendInvitation(tenantId: string, userId: string): Promise<void> {
    try {
      const member = await this.getTeamMember(tenantId, userId);

      if (member.status !== TeamMemberStatus.INVITED) {
        throw new ValidationError("Member has already accepted the invitation");
      }

      // Generate new token
      const invitationToken = crypto.randomBytes(32).toString("hex");

      await this.teamMemberRepo.update(userId, {
        invitationToken,
        invitedAt: new Date(),
      });

      // Get tenant for business name
      const tenant = await this.tenantRepo.findByTenantId(tenantId);

      // Send invitation email
      await this.sendInvitationEmail(
        member,
        tenant?.businessName || "E-Invoicing Platform",
        invitationToken,
      );

      logger.info("Invitation resent", { tenantId, userId });
    } catch (error: any) {
      if (error instanceof NotFoundError || error instanceof ValidationError)
        throw error;
      logger.error("Failed to resend invitation", { error: error.message });
      throw new AppError(500, "Failed to resend invitation");
    }
  }

  private async sendInvitationEmail(
    member: TeamMemberDocument,
    businessName: string,
    token: string,
  ): Promise<void> {
    try {
      const webAppUrl = appConfig?.webAppURL || "http://localhost:3000";
      const invitationUrl = `${webAppUrl}/auth/accept-invite?token=${token}`;

      const mailContent: MailContent = {
        to: member.email,
        subject: `You're invited to join ${businessName} on E-Invoicing Platform`,
        html: withTemplate(
          templateEngine.render("teamInvitation", {
            firstName: member.firstName,
            businessName,
            role: member.role,
            invitationUrl,
          }),
        ),
      };

      await this.sendEmail(mailContent);
      logger.info("Invitation email sent", { email: member.email });
    } catch (error: any) {
      logger.error("Failed to send invitation email", { error: error.message });
      // Don't throw - invitation is still created
    }
  }
}
