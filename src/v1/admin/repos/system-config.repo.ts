import { AppError } from '../../../@lib';
import { SystemConfigDocument, SystemConfigModel, SystemConfigKey } from '../models/system-config.model';

export class SystemConfigRepository {
  /**
   * Get configuration by key
   */
  async getByKey(configKey: string): Promise<SystemConfigDocument | null> {
    try {
      const doc = await SystemConfigModel.findOne({
        configKey,
        isActive: true,
      }).exec();
      return doc;
    } catch (error) {
      console.error('Error fetching system config:', error);
      throw new AppError(500, 'Failed to fetch system configuration');
    }
  }

  /**
   * Create or update configuration
   */
  async upsert(
    configKey: string,
    configValue: any,
    options: {
      description?: string;
      updatedBy?: string;
    } = {}
  ): Promise<SystemConfigDocument> {
    try {
      const existing = await SystemConfigModel.findOne({ configKey }).exec();

      if (existing) {
        const doc = await SystemConfigModel.findOneAndUpdate(
          { configKey },
          {
            $set: {
              configValue,
              description: options.description || existing.description,
              updatedBy: options.updatedBy || 'system',
            },
            $inc: { version: 1 },
          },
          { returnDocument: 'after' }
        ).exec();

        if (!doc) {
          throw new AppError(500, 'Failed to update system configuration');
        }
        return doc;
      } else {
        const doc = await SystemConfigModel.create({
          configKey,
          configValue,
          description: options.description || '',
          createdBy: options.updatedBy || 'system',
          updatedBy: options.updatedBy || 'system',
        });
        return doc;
      }
    } catch (error: any) {
      console.error('Error upserting system config:', error);
      if (error instanceof AppError) throw error;
      throw new AppError(500, 'Failed to save system configuration');
    }
  }

  /**
   * Get all configurations
   */
  async getAll(): Promise<SystemConfigDocument[]> {
    try {
      const docs = await SystemConfigModel.find({ isActive: true })
        .sort({ configKey: 1 })
        .exec();
      return docs;
    } catch (error) {
      console.error('Error fetching all configs:', error);
      throw new AppError(500, 'Failed to fetch system configurations');
    }
  }

  /**
   * Deactivate a configuration
   */
  async deactivate(configKey: string, updatedBy: string = 'system'): Promise<boolean> {
    try {
      const result = await SystemConfigModel.findOneAndUpdate(
        { configKey },
        { $set: { isActive: false, updatedBy } }
      ).exec();
      return result !== null;
    } catch (error) {
      console.error('Error deactivating config:', error);
      throw new AppError(500, 'Failed to deactivate configuration');
    }
  }

  /**
   * Delete a configuration
   */
  async delete(configKey: string): Promise<boolean> {
    try {
      const result = await SystemConfigModel.findOneAndDelete({ configKey }).exec();
      return result !== null;
    } catch (error) {
      console.error('Error deleting config:', error);
      throw new AppError(500, 'Failed to delete configuration');
    }
  }

  /**
   * Get configuration history (all versions)
   */
  async getVersion(configKey: string): Promise<number> {
    try {
      const doc = await SystemConfigModel.findOne({ configKey }).exec();
      return doc?.version || 0;
    } catch (error) {
      console.error('Error fetching config version:', error);
      throw new AppError(500, 'Failed to fetch configuration version');
    }
  }
}
