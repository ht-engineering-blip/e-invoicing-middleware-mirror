import { AppError } from "../../../@lib";
import { ModelWrapper } from "../../../@lib/adapters/mongo/model-wrapper";
import {
  TenantOnboardingDocument,
  TenantOnboardingModel,
  OnboardingStatus,
} from "../models/tenant-onboarding.model";

export class TenantOnboardingRepository {
  private onboardingModel: ModelWrapper<TenantOnboardingDocument>;

  constructor() {
    this.onboardingModel = new ModelWrapper<TenantOnboardingDocument>(
      TenantOnboardingModel,
    );
  }

  /**
   * Build MongoDB query from where conditions
   */
  private buildOnboardingQuery(where?: any): any {
    if (!where) return {};

    const query: any = {};

    // Simple equality checks
    if (where.id?._eq) query._id = where.id._eq;
    if (where.tenantId?._eq) query.tenantId = where.tenantId._eq;
    if (where.tin?._eq) query.tin = where.tin._eq;
    if (where.status?._eq) query.status = where.status._eq;

    // IN conditions
    if (where.status?._in) query.status = { $in: where.status._in };

    // AND conditions
    if (where._and && where._and.length > 0) {
      query.$and = where._and.map((andCondition: any) => {
        return this.buildOnboardingQuery(andCondition);
      });
    }

    return query;
  }

  /**
   * Build select projection
   */
  private buildOnboardingProjection(select?: any): any {
    return select && Object.keys(select).length > 0 ? select : null;
  }

  /**
   * Find many onboarding records
   */
  async findMany(
    where?: any,
    select?: any,
    limit: number = 20,
    offset: number = 0,
  ): Promise<TenantOnboardingDocument[]> {
    try {
      const query = this.buildOnboardingQuery(where);
      const projection = this.buildOnboardingProjection(select);

      const docs = await this.onboardingModel
        .find(query, projection)
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(offset)
        .exec();

      return docs;
    } catch (error) {
      console.error("Error finding onboarding records:", error);
      throw new AppError(500, "Failed to fetch onboarding records");
    }
  }

  /**
   * Find one onboarding record
   */
  async findOne(
    where: any,
    select?: any,
  ): Promise<TenantOnboardingDocument | null> {
    try {
      const query = this.buildOnboardingQuery(where);
      const projection = this.buildOnboardingProjection(select);

      const doc = await this.onboardingModel.findOne(query, projection).exec();

      return doc;
    } catch (error) {
      console.error("Error finding onboarding record:", error);
      throw new AppError(500, "Failed to fetch onboarding record");
    }
  }

  /**
   * Create a new onboarding record
   */
  async create(
    data: Partial<TenantOnboardingDocument>,
  ): Promise<TenantOnboardingDocument> {
    try {
      const doc = await this.onboardingModel.create({
        ...data,
        status: OnboardingStatus.PENDING,
        steps: {
          registration: { completed: false },
          firsProvisioning: { completed: false },
          erpConfiguration: { completed: false },
          testing: { completed: false },
          goLive: { completed: false },
        },
      });

      return doc;
    } catch (error: any) {
      console.error("Error creating onboarding record:", error);
      if (error.name === "ValidationError") {
        throw new AppError(400, error.message);
      }
      throw new AppError(500, "Failed to create onboarding record");
    }
  }

  /**
   * Update an onboarding record
   */
  async update(
    tenantId: string,
    data: Partial<TenantOnboardingDocument>,
  ): Promise<TenantOnboardingDocument> {
    try {
      // Remove undefined values
      const updateData = Object.keys(data).reduce((acc, key: string) => {
        const dataKey = key as keyof TenantOnboardingDocument;
        if (data[dataKey] !== undefined) {
          acc[key] = data[dataKey];
        }
        return acc;
      }, {} as any);

      const doc = await this.onboardingModel
        .findOneAndUpdate(
          { tenantId },
          { $set: updateData },
          { returnDocument: 'after', runValidators: true },
        )
        .exec();

      if (!doc) {
        throw new AppError(404, "Onboarding record not found");
      }

      return doc;
    } catch (error: any) {
      console.error("Error updating onboarding record:", error);
      if (error.name === "ValidationError") {
        throw new AppError(400, error.message);
      }
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(500, "Failed to update onboarding record");
    }
  }

  /**
   * Delete an onboarding record
   */
  async delete(tenantId: string): Promise<boolean> {
    try {
      const result = await this.onboardingModel
        .findOneAndDelete({ tenantId })
        .exec();

      return result !== null;
    } catch (error) {
      console.error("Error deleting onboarding record:", error);
      throw new AppError(500, "Failed to delete onboarding record");
    }
  }

  /**
   * Count onboarding records
   */
  async count(where?: any): Promise<number> {
    try {
      const query = this.buildOnboardingQuery(where);
      const count = await this.onboardingModel.countDocuments(query).exec();
      return count;
    } catch (error) {
      console.error("Error counting onboarding records:", error);
      throw new AppError(500, "Failed to count onboarding records");
    }
  }

  /**
   * Find onboarding record by tenant ID
   */
  async findByTenantId(
    tenantId: string,
  ): Promise<TenantOnboardingDocument | null> {
    try {
      const doc = await this.onboardingModel.findOne({ tenantId }).exec();
      return doc;
    } catch (error) {
      console.error("Error fetching onboarding record:", error);
      throw new AppError(500, "Failed to fetch onboarding record");
    }
  }

  /**
   * Update onboarding status
   */
  async updateStatus(
    tenantId: string,
    status: OnboardingStatus,
  ): Promise<TenantOnboardingDocument> {
    try {
      const doc = await this.onboardingModel
        .findOneAndUpdate({ tenantId }, { $set: { status } }, { returnDocument: 'after' })
        .exec();

      if (!doc) {
        throw new AppError(404, "Onboarding record not found");
      }

      return doc;
    } catch (error) {
      console.error("Error updating onboarding status:", error);
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(500, "Failed to update onboarding status");
    }
  }

  /**
   * Complete an onboarding step
   */
  async completeStep(
    tenantId: string,
    step:
      | "registration"
      | "firsProvisioning"
      | "erpConfiguration"
      | "testing"
      | "goLive",
  ): Promise<TenantOnboardingDocument> {
    try {
      const doc = await this.onboardingModel
        .findOneAndUpdate(
          { tenantId },
          {
            $set: {
              [`steps.${step}.completed`]: true,
              [`steps.${step}.completedAt`]: new Date(),
            },
          },
          { returnDocument: 'after' },
        )
        .exec();

      if (!doc) {
        throw new AppError(404, "Onboarding record not found");
      }

      return doc;
    } catch (error) {
      console.error("Error completing onboarding step:", error);
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(500, "Failed to complete onboarding step");
    }
  }

  /**
   * Approve onboarding
   */
  async approve(
    tenantId: string,
    approvedBy: string,
  ): Promise<TenantOnboardingDocument> {
    try {
      const doc = await this.onboardingModel
        .findOneAndUpdate(
          { tenantId },
          {
            $set: {
              status: OnboardingStatus.ACTIVE,
              approvedBy,
              approvedAt: new Date(),
            },
          },
          { returnDocument: 'after' },
        )
        .exec();

      if (!doc) {
        throw new AppError(404, "Onboarding record not found");
      }

      return doc;
    } catch (error) {
      console.error("Error approving onboarding:", error);
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(500, "Failed to approve onboarding");
    }
  }

  /**
   * Reject onboarding
   */
  async reject(
    tenantId: string,
    rejectedBy: string,
  ): Promise<TenantOnboardingDocument> {
    try {
      const doc = await this.onboardingModel
        .findOneAndUpdate(
          { tenantId },
          {
            $set: {
              status: OnboardingStatus.REJECTED,
              approvedBy: rejectedBy,
              approvedAt: new Date(),
            },
          },
          { returnDocument: 'after' },
        )
        .exec();

      if (!doc) {
        throw new AppError(404, "Onboarding record not found");
      }

      return doc;
    } catch (error) {
      console.error("Error rejecting onboarding:", error);
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(500, "Failed to reject onboarding");
    }
  }

  /**
   * Get onboarding records by status
   */
  async findByStatus(
    status: OnboardingStatus,
    limit: number = 20,
    page: number = 1,
  ): Promise<{ data: TenantOnboardingDocument[]; meta: any }> {
    try {
      const offset = (page - 1) * limit;
      const query: any = { status };

      const [docs, total] = await Promise.all([
        this.onboardingModel
          .find(query)
          .sort({ createdAt: -1 })
          .limit(limit)
          .skip(offset)
          .exec(),
        this.onboardingModel.countDocuments(query).exec(),
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
      console.error("Error fetching onboarding records by status:", error);
      throw new AppError(500, "Failed to fetch onboarding records");
    }
  }

  /**
   * Get pending onboarding records
   */
  async findPending(
    limit: number = 20,
    page: number = 1,
  ): Promise<{ data: TenantOnboardingDocument[]; meta: any }> {
    return this.findByStatus(OnboardingStatus.PENDING, limit, page);
  }

  /**
   * Get in-progress onboarding records
   */
  async findInProgress(
    limit: number = 20,
    page: number = 1,
  ): Promise<{ data: TenantOnboardingDocument[]; meta: any }> {
    return this.findByStatus(OnboardingStatus.IN_PROGRESS, limit, page);
  }
}
