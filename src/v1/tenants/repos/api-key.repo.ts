import { AppError } from '../../../@lib';
import { ModelWrapper } from '../../../@lib/adapters/mongo/model-wrapper';
import { ApiKeyDocument, ApiKeyModel, ApiKeyStatus } from '../models/api-key.model';

export class ApiKeyRepository {
  private apiKeyModel: ModelWrapper<ApiKeyDocument>;

  constructor() {
    this.apiKeyModel = new ModelWrapper<ApiKeyDocument>(ApiKeyModel);
  }

  /**
   * Build MongoDB query from where conditions
   */
  private buildApiKeyQuery(where?: any): any {
    if (!where) return {};

    const query: any = {};

    // Simple equality checks
    if (where.id?._eq) query._id = where.id._eq;
    if (where.tenantId?._eq) query.tenantId = where.tenantId._eq;
    if (where.businessId?._eq) query.businessId = where.businessId._eq;
    if (where.keyHash?._eq) query.keyHash = where.keyHash._eq;
    if (where.keyPrefix?._eq) query.keyPrefix = where.keyPrefix._eq;
    if (where.status?._eq) query.status = where.status._eq;

    // IN conditions
    if (where.status?._in) query.status = { $in: where.status._in };

    // AND conditions
    if (where._and && where._and.length > 0) {
      query.$and = where._and.map((andCondition: any) => {
        return this.buildApiKeyQuery(andCondition);
      });
    }

    return query;
  }

  /**
   * Build select projection
   */
  private buildApiKeyProjection(select?: any): any {
    return select && Object.keys(select).length > 0 ? select : null;
  }

  /**
   * Find many API keys
   */
  async findMany(
    where?: any,
    select?: any,
    limit: number = 20,
    offset: number = 0
  ): Promise<ApiKeyDocument[]> {
    try {
      const query = this.buildApiKeyQuery(where);
      const projection = this.buildApiKeyProjection(select);

      const docs = await this.apiKeyModel
        .find(query, projection)
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(offset)
        .exec();

      return docs;
    } catch (error) {
      console.error('Error finding API keys:', error);
      throw new AppError(500, 'Failed to fetch API keys');
    }
  }

  /**
   * Find one API key
   */
  async findOne(where: any, select?: any): Promise<ApiKeyDocument | null> {
    try {
      const query = this.buildApiKeyQuery(where);
      const projection = this.buildApiKeyProjection(select);

      const doc = await this.apiKeyModel.base.findOne(query, projection).exec();

      return doc;
    } catch (error) {
      console.error('Error finding API key:', error);
      throw new AppError(500, 'Failed to fetch API key');
    }
  }

  /**
   * Create a new API key
   */
  async create(data: Partial<ApiKeyDocument>): Promise<ApiKeyDocument> {
    try {
      const doc = await this.apiKeyModel.create({
        ...data,
        usageCount: 0,
        status: ApiKeyStatus.ACTIVE,
      });

      return doc;
    } catch (error: any) {
      console.error('Error creating API key:', error);
      if (error.name === 'ValidationError') {
        throw new AppError(400, error.message);
      }
      if (error.code === 11000) {
        throw new AppError(409, 'API key with this hash already exists');
      }
      throw new AppError(500, 'Failed to create API key');
    }
  }

  /**
   * Update an API key
   */
  async update(keyId: string, data: Partial<ApiKeyDocument>): Promise<ApiKeyDocument> {
    try {
      // Remove undefined values
      const updateData = Object.keys(data).reduce((acc, key: string) => {
        const dataKey = key as keyof ApiKeyDocument;
        if (data[dataKey] !== undefined) {
          acc[key] = data[dataKey];
        }
        return acc;
      }, {} as any);

      const doc = await this.apiKeyModel.base
        .findByIdAndUpdate(keyId, { $set: updateData }, { new: true, runValidators: true })
        .exec();

      if (!doc) {
        throw new AppError(404, 'API key not found');
      }

      return doc;
    } catch (error: any) {
      console.error('Error updating API key:', error);
      if (error.name === 'ValidationError') {
        throw new AppError(400, error.message);
      }
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(500, 'Failed to update API key');
    }
  }

  /**
   * Delete an API key
   */
  async delete(keyId: string): Promise<boolean> {
    try {
      const result = await this.apiKeyModel.base.findByIdAndDelete(keyId).exec();

      return result !== null;
    } catch (error) {
      console.error('Error deleting API key:', error);
      throw new AppError(500, 'Failed to delete API key');
    }
  }

  /**
   * Count API keys
   */
  async count(where?: any): Promise<number> {
    try {
      const query = this.buildApiKeyQuery(where);
      const count = await this.apiKeyModel.countDocuments(query).exec();
      return count;
    } catch (error) {
      console.error('Error counting API keys:', error);
      throw new AppError(500, 'Failed to count API keys');
    }
  }

  /**
   * Find API keys by tenant ID
   */
  async findByTenantId(
    tenantId: string,
    limit: number = 20,
    page: number = 1
  ): Promise<{ data: ApiKeyDocument[]; meta: any }> {
    try {
      const offset = (page - 1) * limit;
      const query: any = { tenantId };

      const [docs, total] = await Promise.all([
        this.apiKeyModel.base
          .find(query)
          .sort({ createdAt: -1 })
          .limit(limit)
          .skip(offset)
          .exec(),
        this.apiKeyModel.countDocuments(query).exec(),
      ]);

      const meta = {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      };

      return {
        data: docs,
        meta,
      };
    } catch (error) {
      console.error('Error fetching API keys:', error);
      throw new AppError(500, 'Failed to fetch API keys');
    }
  }

  /**
   * Find API key by hash
   */
  async findByKeyHash(keyHash: string): Promise<ApiKeyDocument | null> {
    try {
      const doc = await this.apiKeyModel.base.findOne({ keyHash }).exec();
      return doc;
    } catch (error) {
      console.error('Error fetching API key:', error);
      throw new AppError(500, 'Failed to fetch API key');
    }
  }

  /**
   * Find API key by prefix
   */
  async findByKeyPrefix(keyPrefix: string): Promise<ApiKeyDocument | null> {
    try {
      const doc = await this.apiKeyModel.base.findOne({ keyPrefix }).exec();
      return doc;
    } catch (error) {
      console.error('Error fetching API key:', error);
      throw new AppError(500, 'Failed to fetch API key');
    }
  }

  /**
   * Revoke an API key
   */
  async revoke(
    keyId: string,
    revokedBy: string,
    reason: string
  ): Promise<ApiKeyDocument> {
    try {
      const doc = await this.apiKeyModel.base
        .findByIdAndUpdate(
          keyId,
          {
            $set: {
              status: ApiKeyStatus.REVOKED,
              revokedAt: new Date(),
              revokedBy,
              revokedReason: reason,
            },
          },
          { new: true }
        )
        .exec();

      if (!doc) {
        throw new AppError(404, 'API key not found');
      }

      return doc;
    } catch (error) {
      console.error('Error revoking API key:', error);
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(500, 'Failed to revoke API key');
    }
  }

  /**
   * Update last used timestamp and increment usage count
   */
  async updateLastUsed(keyHash: string): Promise<void> {
    try {
      await this.apiKeyModel.base
        .findOneAndUpdate(
          { keyHash },
          {
            $set: { lastUsedAt: new Date() },
            $inc: { usageCount: 1 },
          }
        )
        .exec();
    } catch (error) {
      console.error('Error updating API key last used:', error);
      // Don't throw error, just log it
    }
  }

  /**
   * Find expired API keys
   */
  async findExpired(): Promise<ApiKeyDocument[]> {
    try {
      const docs = await this.apiKeyModel.base
        .find({
          expiresAt: { $lte: new Date() },
          status: ApiKeyStatus.ACTIVE,
        })
        .exec();

      return docs;
    } catch (error) {
      console.error('Error finding expired API keys:', error);
      throw new AppError(500, 'Failed to find expired API keys');
    }
  }

  /**
   * Mark expired keys as expired
   */
  async markExpired(): Promise<number> {
    try {
      const result = await this.apiKeyModel.base
        .updateMany(
          {
            expiresAt: { $lte: new Date() },
            status: ApiKeyStatus.ACTIVE,
          },
          {
            $set: { status: ApiKeyStatus.EXPIRED },
          }
        )
        .exec();

      return result.modifiedCount || 0;
    } catch (error) {
      console.error('Error marking expired API keys:', error);
      throw new AppError(500, 'Failed to mark expired API keys');
    }
  }

  /**
   * Get active API keys for a tenant
   */
  async findActiveByTenantId(tenantId: string): Promise<ApiKeyDocument[]> {
    try {
      const docs = await this.apiKeyModel.base
        .find({
          tenantId,
          status: ApiKeyStatus.ACTIVE,
        })
        .sort({ createdAt: -1 })
        .exec();

      return docs;
    } catch (error) {
      console.error('Error fetching active API keys:', error);
      throw new AppError(500, 'Failed to fetch active API keys');
    }
  }

  /**
   * Bulk revoke API keys
   */
  async bulkRevoke(
    keyIds: string[],
    revokedBy: string,
    reason: string
  ): Promise<number> {
    try {
      const result = await this.apiKeyModel.base
        .updateMany(
          { _id: { $in: keyIds } },
          {
            $set: {
              status: ApiKeyStatus.REVOKED,
              revokedAt: new Date(),
              revokedBy,
              revokedReason: reason,
            },
          }
        )
        .exec();

      return result.modifiedCount || 0;
    } catch (error) {
      console.error('Error bulk revoking API keys:', error);
      throw new AppError(500, 'Failed to bulk revoke API keys');
    }
  }
}
