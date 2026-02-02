import { logger } from '../../../@lib/logger';
import { AppError } from '../../../@lib';
import { ModelWrapper } from '../../../@lib/adapters/mongo/model-wrapper';
import { TenantDocument, TenantModel, TenantStatus } from '../models/tenant.model';

export class TenantRepository {
  private tenantModel: ModelWrapper<TenantDocument>;

  constructor() {
    this.tenantModel = new ModelWrapper<TenantDocument>(TenantModel);
  }

  /**
   * Build MongoDB query from where conditions
   */
  private buildTenantQuery(where?: any): any {
    if (!where) return {};

    const query: any = {};

    // Simple equality checks
    if (where.id?._eq) query._id = where.id._eq;
    if (where.tenantId?._eq) query.tenantId = where.tenantId._eq;
    if (where.businessId?._eq) query.businessId = where.businessId._eq;
    if (where.tin?._eq) query.tin = where.tin._eq;
    if (where.status?._eq) query.status = where.status._eq;

    // IN conditions
    if (where.status?._in) query.status = { $in: where.status._in };

    // Search conditions
    if (where.search) {
      query.$or = [
        { businessName: new RegExp(where.search, 'i') },
        { tin: new RegExp(where.search, 'i') },
        { tenantId: new RegExp(where.search, 'i') },
      ];
    }

    // AND conditions
    if (where._and && where._and.length > 0) {
      query.$and = where._and.map((andCondition: any) => {
        return this.buildTenantQuery(andCondition);
      });
    }

    return query;
  }

  /**
   * Build select projection
   */
  private buildTenantProjection(select?: any): any {
    return select && Object.keys(select).length > 0 ? select : null;
  }

  /**
   * Find many tenants with pagination
   */
  async findMany(
    where?: any,
    select?: any,
    limit: number = 20,
    offset: number = 0
  ): Promise<TenantDocument[]> {
    try {
      const query = this.buildTenantQuery(where);
      const projection = this.buildTenantProjection(select);

      const docs = await this.tenantModel
        .find(query, projection)
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(offset)
        .exec();

      return docs;
    } catch (error) {
      console.error('Error finding tenants:', error);
      throw new AppError(500, 'Failed to fetch tenants');
    }
  }

  /**
   * Find one tenant
   */
  async findOne(where: any, select?: any): Promise<TenantDocument | null> {
    try {
      const query = this.buildTenantQuery(where);
      const projection = this.buildTenantProjection(select);

      const doc = await this.tenantModel.base.findOne(query, projection).exec();

      return doc;
    } catch (error) {
      console.error('Error finding tenant:', error);
      throw new AppError(500, 'Failed to fetch tenant');
    }
  }

  /**
   * Create a new tenant
   */
  async create(data: Partial<TenantDocument>): Promise<TenantDocument> {
    try {
      logger.info("Creating", JSON.stringify(data, undefined, 2))
      const doc = await this.tenantModel.createWithTenant({
        ...data,
      }, false);

      return doc;
    } catch (error: any) {
      console.error('Error creating tenant:', error);
      if (error.name === 'ValidationError') {
        throw new AppError(400, error.message);
      }
      if (error.code === 11000) {
        throw new AppError(409, 'Tenant with this tenantId or businessId already exists');
      }
      throw new AppError(500, 'Failed to create tenant');
    }
  }

  /**
   * Update a tenant
   */
  async update(tenantId: string, data: Partial<TenantDocument>): Promise<TenantDocument> {
    try {
       console.log(data)
      // Remove undefined values
      const updateData = Object.keys(data).reduce((acc, key: string) => {
        const dataKey = key as keyof TenantDocument;
        if (data[dataKey] !== undefined) {
          acc[key] = data[dataKey];
        }
        return acc;
      }, {} as any);

     
      const doc = await this.tenantModel.base
        .findOneAndUpdate({ tenantId }, { $set: updateData }, { new: true, runValidators: true })
        .exec();

      if (!doc) {
        throw new AppError(404, 'Tenant not found');
      }

      return doc;
    } catch (error: any) {
      console.error('Error updating tenant:', error);
      if (error.name === 'ValidationError') {
        throw new AppError(400, error.message);
      }
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(500, 'Failed to update tenant');
    }
  }

  /**
   * Delete a tenant (soft delete)
   */
  async delete(tenantId: string): Promise<boolean> {
    try {
      const result = await this.tenantModel.base
        .findOneAndUpdate({ tenantId }, { $set: { status: TenantStatus.INACTIVE } }, { new: true })
        .exec();

      return result !== null;
    } catch (error) {
      console.error('Error deleting tenant:', error);
      throw new AppError(500, 'Failed to delete tenant');
    }
  }

  /**
   * Hard delete a tenant (only for cleanup/testing)
   */
  async hardDelete(tenantId: string): Promise<boolean> {
    try {
      const result = await this.tenantModel.base.findOneAndDelete({ tenantId }).exec();

      return result !== null;
    } catch (error) {
      console.error('Error hard deleting tenant:', error);
      throw new AppError(500, 'Failed to delete tenant');
    }
  }

  /**
   * Count tenants
   */
  async count(where?: any): Promise<number> {
    try {
      const query = this.buildTenantQuery(where);
      const count = await this.tenantModel.countDocumentsWithTenant(query, false).exec();
      return count;
    } catch (error) {
      console.error('Error counting tenants:', error);
      throw new AppError(500, 'Failed to count tenants');
    }
  }

  /**
   * Find tenant by tenant ID
   */
  async findByTenantId(tenantId: string): Promise<TenantDocument | null> {
    try {
      const doc = await this.tenantModel.base.findOne({ tenantId }).exec();
      return doc;
    } catch (error) {
      console.error('Error fetching tenant:', error);
      throw new AppError(500, 'Failed to fetch tenant');
    }
  }

  /**
   * Find tenant by business ID
   */
  async findByBusinessId(businessId: string): Promise<TenantDocument | null> {
    try {
      const doc = await this.tenantModel.base.findOne({ businessId }).exec();
      return doc;
    } catch (error) {
      console.error('Error fetching tenant:', error);
      throw new AppError(500, 'Failed to fetch tenant');
    }
  }

  /**
   * Find tenant by TIN
   */
  async findByTIN(tin: string): Promise<TenantDocument | null> {
    try {
      const doc = await this.tenantModel.base.findOne({ tin }).exec();
      return doc;
    } catch (error) {
      console.error('Error fetching tenant:', error);
      throw new AppError(500, 'Failed to fetch tenant');
    }
  }

  /**
   * Search tenants
   */
  async searchTenants(
    searchQuery: string,
    limit: number = 20,
    page: number = 1
  ): Promise<{ data: TenantDocument[]; meta: any }> {
    try {
      const offset = (page - 1) * limit;

      const query: any = {
        $or: [
          { businessName: new RegExp(searchQuery, 'i') },
          { tin: new RegExp(searchQuery, 'i') },
          { tenantId: new RegExp(searchQuery, 'i') },
        ],
      };

      const [docs, total] = await Promise.all([
        this.tenantModel.base.find(query).sort({ createdAt: -1 }).limit(limit).skip(offset).exec(),
        this.tenantModel.countDocuments(query).exec(),
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
      console.error('Error searching tenants:', error);
      throw new AppError(500, 'Failed to search tenants');
    }
  }

  /**
   * Activate tenant
   */
  async activate(tenantId: string): Promise<TenantDocument> {
    try {
      const doc = await this.tenantModel.base
        .findOneAndUpdate({ tenantId }, { $set: { status: TenantStatus.ACTIVE } }, { new: true })
        .exec();

      if (!doc) {
        throw new AppError(404, 'Tenant not found');
      }

      return doc;
    } catch (error) {
      console.error('Error activating tenant:', error);
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(500, 'Failed to activate tenant');
    }
  }

  /**
   * Suspend tenant
   */
  async suspend(tenantId: string): Promise<TenantDocument> {
    try {
      const doc = await this.tenantModel.base
        .findOneAndUpdate(
          { tenantId },
          { $set: { status: TenantStatus.SUSPENDED } },
          { new: true }
        )
        .exec();

      if (!doc) {
        throw new AppError(404, 'Tenant not found');
      }

      return doc;
    } catch (error) {
      console.error('Error suspending tenant:', error);
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(500, 'Failed to suspend tenant');
    }
  }

  /**
   * Update FIRS credentials
   */
  async updateFIRSCredentials(
    tenantId: string,
    credentials: {
      clientId: string;  
      serviceId: string;  
      certificate: string;
      publicKey: string;
    }
  ): Promise<TenantDocument> {
    try {
      const doc = await this.tenantModel.base
        .findOneAndUpdate(
          { tenantId },
          {
            $set: {
              'config.firsCredentials.clientId': credentials.clientId, 
              'config.firsCredentials.serviceId': credentials.serviceId, 
              'config.firsCredentials.certificate': credentials.certificate,
              'config.firsCredentials.publicKey': credentials.publicKey,
            },
          },
          { new: true }
        )
        .exec();

      if (!doc) {
        throw new AppError(404, 'Tenant not found');
      }

      return doc;
    } catch (error) {
      console.error('Error updating FIRS credentials:', error);
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(500, 'Failed to update FIRS credentials');
    }
  }

  /**
   * Bulk update tenants
   */
  async bulkUpdate(updates: Array<{ tenantId: string; data: Partial<TenantDocument> }>): Promise<boolean> {
    try {
      const bulkOps = updates.map((update) => ({
        updateOne: {
          filter: { tenantId: update.tenantId },
          update: { $set: update.data },
        },
      }));

      const result = await this.tenantModel.base.bulkWrite(bulkOps);
      return result.modifiedCount > 0;
    } catch (error) {
      console.error('Error bulk updating tenants:', error);
      throw new AppError(500, 'Failed to bulk update tenants');
    }
  }

  /**
   * Get tenants by status with pagination
   */
  async findByStatus(
    status: TenantStatus,
    limit: number = 20,
    page: number = 1
  ): Promise<{ data: TenantDocument[]; meta: any }> {
    try {
      const offset = (page - 1) * limit;
      const query: any = { status };

      const [docs, total] = await Promise.all([
        this.tenantModel.base.find(query).sort({ createdAt: -1 }).limit(limit).skip(offset).exec(),
        this.tenantModel.countDocuments(query).exec(),
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
      console.error('Error fetching tenants by status:', error);
      throw new AppError(500, 'Failed to fetch tenants');
    }
  }
}
