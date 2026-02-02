import { AppError } from '../../../@lib';
import {
  TeamMemberDocument,
  TeamMemberModel,
  TeamMemberStatus,
  TeamMemberRole,
} from '../models/team-member.model';

export class TeamMemberRepository {
  /**
   * Create a new team member
   */
  async create(data: Partial<TeamMemberDocument>): Promise<TeamMemberDocument> {
    try {
      const doc = await TeamMemberModel.create(data);
      return doc;
    } catch (error: any) {
      console.error('Error creating team member:', error);
      if (error.code === 11000) {
        throw new AppError(409, 'Team member with this email already exists');
      }
      throw new AppError(500, 'Failed to create team member');
    }
  }

  /**
   * Find team member by user ID
   */
  async findByUserId(userId: string): Promise<TeamMemberDocument | null> {
    try {
      const doc = await TeamMemberModel.findOne({ userId }).exec();
      return doc;
    } catch (error) {
      console.error('Error finding team member:', error);
      throw new AppError(500, 'Failed to find team member');
    }
  }

  /**
   * Find team member by email within a tenant
   */
  async findByTenantAndEmail(
    tenantId: string,
    email: string
  ): Promise<TeamMemberDocument | null> {
    try {
      const doc = await TeamMemberModel.findOne({
        tenantId,
        email: email.toLowerCase(),
      }).exec();
      return doc;
    } catch (error) {
      console.error('Error finding team member:', error);
      throw new AppError(500, 'Failed to find team member');
    }
  }

  /**
   * Find team member by email (across all tenants)
   */
  async findByEmail(email: string): Promise<TeamMemberDocument | null> {
    try {
      const doc = await TeamMemberModel.findOne({
        email: email.toLowerCase(),
      }).exec();
      return doc;
    } catch (error) {
      console.error('Error finding team member by email:', error);
      throw new AppError(500, 'Failed to find team member');
    }
  }

  /**
   * Find team member by invitation token
   */
  async findByInvitationToken(token: string): Promise<TeamMemberDocument | null> {
    try {
      const doc = await TeamMemberModel.findOne({
        invitationToken: token,
        status: TeamMemberStatus.INVITED,
      }).exec();
      return doc;
    } catch (error) {
      console.error('Error finding team member by token:', error);
      throw new AppError(500, 'Failed to find team member');
    }
  }

  /**
   * List team members for a tenant
   */
  async findByTenant(
    tenantId: string,
    options: {
      status?: TeamMemberStatus;
      role?: TeamMemberRole;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<{ data: TeamMemberDocument[]; total: number }> {
    try {
      const query: any = { tenantId };

      if (options.status) query.status = options.status;
      if (options.role) query.role = options.role;

      const limit = options.limit || 20;
      const offset = options.offset || 0;

      const [data, total] = await Promise.all([
        TeamMemberModel.find(query)
          .sort({ createdAt: -1 })
          .skip(offset)
          .limit(limit)
          .exec(),
        TeamMemberModel.countDocuments(query).exec(),
      ]);

      return { data, total };
    } catch (error) {
      console.error('Error listing team members:', error);
      throw new AppError(500, 'Failed to list team members');
    }
  }

  /**
   * Update team member
   */
  async update(
    userId: string,
    data: Partial<TeamMemberDocument>
  ): Promise<TeamMemberDocument | null> {
    try {
      const doc = await TeamMemberModel.findOneAndUpdate(
        { userId },
        { $set: data },
        { new: true }
      ).exec();
      return doc;
    } catch (error) {
      console.error('Error updating team member:', error);
      throw new AppError(500, 'Failed to update team member');
    }
  }

  /**
   * Delete team member
   */
  async delete(userId: string): Promise<boolean> {
    try {
      const result = await TeamMemberModel.findOneAndDelete({ userId }).exec();
      return result !== null;
    } catch (error) {
      console.error('Error deleting team member:', error);
      throw new AppError(500, 'Failed to delete team member');
    }
  }

  /**
   * Count team members by tenant
   */
  async countByTenant(tenantId: string, status?: TeamMemberStatus): Promise<number> {
    try {
      const query: any = { tenantId };
      if (status) query.status = status;

      return await TeamMemberModel.countDocuments(query).exec();
    } catch (error) {
      console.error('Error counting team members:', error);
      throw new AppError(500, 'Failed to count team members');
    }
  }

  /**
   * Check if user is owner of tenant
   */
  async isOwner(tenantId: string, userId: string): Promise<boolean> {
    try {
      const member = await TeamMemberModel.findOne({
        tenantId,
        userId,
        role: TeamMemberRole.OWNER,
      }).exec();
      return member !== null;
    } catch (error) {
      console.error('Error checking owner status:', error);
      throw new AppError(500, 'Failed to check owner status');
    }
  }
}
