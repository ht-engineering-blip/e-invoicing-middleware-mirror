import { AppError } from '../../../@lib';
import { PasswordResetDocument, PasswordResetModel } from '../models/password-reset.model';

export class PasswordResetRepository {
  /**
   * Create a new password reset token
   */
  async create(data: {
    tenantId: string;
    email: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<PasswordResetDocument> {
    try {
      const doc = await PasswordResetModel.create(data);
      return doc;
    } catch (error: any) {
      console.error('Error creating password reset token:', error);
      if (error.code === 11000) {
        throw new AppError(409, 'A reset token already exists');
      }
      throw new AppError(500, 'Failed to create password reset token');
    }
  }

  /**
   * Find reset token by hash
   */
  async findByTokenHash(tokenHash: string): Promise<PasswordResetDocument | null> {
    try {
      const doc = await PasswordResetModel.findOne({
        tokenHash,
        expiresAt: { $gt: new Date() },
        usedAt: { $exists: false },
      }).exec();
      return doc;
    } catch (error) {
      console.error('Error finding password reset token:', error);
      throw new AppError(500, 'Failed to find password reset token');
    }
  }

  /**
   * Find active reset token by email
   */
  async findActiveByEmail(email: string): Promise<PasswordResetDocument | null> {
    try {
      const doc = await PasswordResetModel.findOne({
        email: email.toLowerCase(),
        expiresAt: { $gt: new Date() },
        usedAt: { $exists: false },
      }).exec();
      return doc;
    } catch (error) {
      console.error('Error finding active reset token:', error);
      throw new AppError(500, 'Failed to find active reset token');
    }
  }

  /**
   * Mark token as used
   */
  async markAsUsed(tokenHash: string): Promise<PasswordResetDocument | null> {
    try {
      const doc = await PasswordResetModel.findOneAndUpdate(
        { tokenHash },
        { $set: { usedAt: new Date() } },
        { returnDocument: 'after' }
      ).exec();
      return doc;
    } catch (error) {
      console.error('Error marking reset token as used:', error);
      throw new AppError(500, 'Failed to mark token as used');
    }
  }

  /**
   * Delete all reset tokens for a tenant
   */
  async deleteByTenantId(tenantId: string): Promise<number> {
    try {
      const result = await PasswordResetModel.deleteMany({ tenantId }).exec();
      return result.deletedCount || 0;
    } catch (error) {
      console.error('Error deleting reset tokens:', error);
      throw new AppError(500, 'Failed to delete reset tokens');
    }
  }

  /**
   * Delete all reset tokens for an email
   */
  async deleteByEmail(email: string): Promise<number> {
    try {
      const result = await PasswordResetModel.deleteMany({
        email: email.toLowerCase(),
      }).exec();
      return result.deletedCount || 0;
    } catch (error) {
      console.error('Error deleting reset tokens:', error);
      throw new AppError(500, 'Failed to delete reset tokens');
    }
  }

  /**
   * Clean up expired tokens (manual cleanup if needed)
   */
  async cleanupExpired(): Promise<number> {
    try {
      const result = await PasswordResetModel.deleteMany({
        expiresAt: { $lt: new Date() },
      }).exec();
      return result.deletedCount || 0;
    } catch (error) {
      console.error('Error cleaning up expired tokens:', error);
      throw new AppError(500, 'Failed to cleanup expired tokens');
    }
  }
}
