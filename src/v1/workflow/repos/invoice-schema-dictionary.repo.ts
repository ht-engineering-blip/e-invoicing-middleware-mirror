import { AppError, safeSearchRegExp } from "../../../@lib";
import { ModelWrapper } from "../../../@lib/adapters/mongo/model-wrapper";
import {
  InvoiceSchemaDictionaryDocument,
  InvoiceSchemaDictionaryModel,
  SchemaSourceType,
  SchemaStatus,
  ISchemaField,
} from "../models/invoice-schema-dictionary.model";

/**
 * Input for creating a new schema dictionary
 */
export interface CreateSchemaDictionaryInput {
  schema_id: string;
  name: string;
  description?: string;
  version?: string;
  source_type: SchemaSourceType | string;
  source_version?: string;
  status?: SchemaStatus;
  is_default?: boolean;
  tenant_id?: string;
  fields: ISchemaField[];
  mapping_rules?: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
  tags?: string[];
  created_by: string;
}

/**
 * Input for updating a schema dictionary
 */
export interface UpdateSchemaDictionaryInput {
  name?: string;
  description?: string;
  version?: string;
  source_version?: string;
  status?: SchemaStatus;
  is_default?: boolean;
  fields?: ISchemaField[];
  mapping_rules?: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
  tags?: string[];
  updated_by: string;
}

/**
 * Query filters for listing schemas
 */
export interface SchemaDictionaryFilters {
  source_type?: SchemaSourceType | string;
  status?: SchemaStatus;
  tenant_id?: string;
  is_default?: boolean;
  tags?: string[];
  search?: string;
}

/**
 * Invoice Schema Dictionary Repository
 */
export class InvoiceSchemaDictionaryRepository {
  private model: ModelWrapper<InvoiceSchemaDictionaryDocument>;

  constructor() {
    this.model = new ModelWrapper<InvoiceSchemaDictionaryDocument>(
      InvoiceSchemaDictionaryModel,
    );
  }

  /**
   * Build MongoDB query from filters
   */
  private buildQuery(filters?: SchemaDictionaryFilters): Record<string, unknown> {
    if (!filters) return {};

    const query: Record<string, unknown> = {};

    if (filters.source_type) query.source_type = filters.source_type;
    if (filters.status) query.status = filters.status;
    if (filters.tenant_id) query.tenant_id = filters.tenant_id;
    if (filters.is_default !== undefined) query.is_default = filters.is_default;
    if (filters.tags && filters.tags.length > 0)
      query.tags = { $in: filters.tags };

    if (filters.search) {
      query.$or = [
        { name: safeSearchRegExp(filters.search) },
        { description: safeSearchRegExp(filters.search) },
        { schema_id: safeSearchRegExp(filters.search) },
      ];
    }

    return query;
  }

  /**
   * Create a new schema dictionary
   */
  async create(
    input: CreateSchemaDictionaryInput,
  ): Promise<InvoiceSchemaDictionaryDocument> {
    try {
      // If setting as default, unset other defaults for this source type
      if (input.is_default) {
        await this.model.updateMany(
          { source_type: input.source_type, is_default: true },
          { $set: { is_default: false } },
        );
      }

      const doc = await this.model.create({
        ...input,
        version: input.version || "1.0.0",
        status: input.status || SchemaStatus.DRAFT,
        is_default: input.is_default || false,
      });

      return doc;
    } catch (error: unknown) {
      console.error("Error creating schema dictionary:", error);
      const err = error as { code?: number };
      if (err.code === 11000) {
        throw new AppError(409, "Schema with this ID already exists");
      }
      throw new AppError(500, "Failed to create schema dictionary");
    }
  }

  /**
   * Find schema by ID
   */
  async findById(id: string): Promise<InvoiceSchemaDictionaryDocument | null> {
    try {
      const doc = await this.model.findById(id).exec();
      return doc;
    } catch (error: unknown) {
      console.error("Error finding schema by ID:", error);
      return null;
    }
  }

  /**
   * Find schema by schema_id
   */
  async findBySchemaId(
    schemaId: string,
  ): Promise<InvoiceSchemaDictionaryDocument | null> {
    try {
      const doc = await this.model.findOne({ schema_id: schemaId }).exec();
      return doc;
    } catch (error: unknown) {
      console.error("Error finding schema by schema_id:", error);
      return null;
    }
  }

  /**
   * Find default schema for a source type
   */
  async findDefaultBySourceType(
    sourceType: SchemaSourceType | string,
  ): Promise<InvoiceSchemaDictionaryDocument | null> {
    try {
      const sourceStr = String(sourceType || "");
      const escaped = sourceStr.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
      // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
      const regex = new RegExp(`^${escaped}$`, "i");

      let doc = await this.model
        .findOne({
          source_type: { $regex: regex },
          is_default: true,
          status: SchemaStatus.ACTIVE,
        })
        .exec();

      if (doc) {
        return doc;
      }

      doc = await this.model
        .findOne({
          source_type: { $regex: regex },
          status: SchemaStatus.ACTIVE,
        })
        .sort({ is_default: -1, createdAt: -1 })
        .exec();

      if (doc) {
        return doc;
      }

      doc = await this.model
        .findOne({
          source_type: { $regex: regex },
        })
        .sort({ is_default: -1, createdAt: -1 })
        .exec();

      return doc;
    } catch (error: unknown) {
      console.error("Error finding default schema for source type:", sourceType, error);
      return null;
    }
  }

  /**
   * Find all schemas for a source type
   */
  async findBySourceType(
    sourceType: SchemaSourceType | string,
    includeInactive: boolean = false,
  ): Promise<InvoiceSchemaDictionaryDocument[]> {
    try {
      const sourceStr = String(sourceType || "");
      const escaped = sourceStr.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
      // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
      const regex = new RegExp(`^${escaped}$`, "i");

      const query: Record<string, unknown> = { source_type: { $regex: regex } };
      if (!includeInactive) {
        query.status = SchemaStatus.ACTIVE;
      }

      const docs = await this.model
        .find(query)
        .sort({ is_default: -1, createdAt: -1 })
        .exec();
      return docs;
    } catch (error: unknown) {
      console.error("Error finding schemas by source type:", error);
      return [];
    }
  }

  /**
   * Find schemas with pagination
   */
  async findMany(
    filters?: SchemaDictionaryFilters,
    limit: number = 20,
    page: number = 1,
  ): Promise<{ data: InvoiceSchemaDictionaryDocument[]; meta: { total: number; page: number; limit: number; pages: number } }> {
    try {
      const offset = (page - 1) * limit;
      const query = this.buildQuery(filters);

      const [docs, total] = await Promise.all([
        this.model
          .find(query)
          .sort({ source_type: 1, is_default: -1, createdAt: -1 })
          .limit(limit)
          .skip(offset)
          .exec(),
        this.model.countDocuments(query).exec(),
      ]);

      const meta = {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      };

      return { data: docs, meta };
    } catch (error: unknown) {
      console.error("Error finding schemas:", error);
      throw new AppError(500, "Failed to fetch schemas");
    }
  }

  /**
   * Update a schema dictionary
   */
  async update(
    schemaId: string,
    input: UpdateSchemaDictionaryInput,
  ): Promise<InvoiceSchemaDictionaryDocument> {
    try {
      // If setting as default, first get the schema to know its source type
      if (input.is_default) {
        const schema = await this.findBySchemaId(schemaId);
        if (schema) {
          await this.model.updateMany(
            {
              source_type: schema.source_type,
              is_default: true,
              schema_id: { $ne: schemaId },
            },
            { $set: { is_default: false } },
          );
        }
      }

      const doc = await this.model
        .findOneAndUpdate(
          { schema_id: schemaId },
          { $set: input },
          { returnDocument: 'after', runValidators: true },
        )
        .exec();

      if (!doc) {
        throw new AppError(404, "Schema dictionary not found");
      }

      return doc;
    } catch (error: unknown) {
      console.error("Error updating schema:", error);
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to update schema dictionary");
    }
  }

  /**
   * Add fields to a schema
   */
  async addFields(
    schemaId: string,
    fields: ISchemaField[],
    updatedBy: string,
  ): Promise<InvoiceSchemaDictionaryDocument> {
    try {
      const doc = await this.model
        .findOneAndUpdate(
          { schema_id: schemaId },
          {
            $push: { fields: { $each: fields } },
            $set: { updated_by: updatedBy },
          },
          { returnDocument: 'after' },
        )
        .exec();

      if (!doc) {
        throw new AppError(404, "Schema dictionary not found");
      }

      return doc;
    } catch (error: unknown) {
      console.error("Error adding fields:", error);
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to add fields");
    }
  }

  /**
   * Update a specific field in a schema
   */
  async updateField(
    schemaId: string,
    fieldId: string,
    fieldUpdate: Partial<ISchemaField>,
    updatedBy: string,
  ): Promise<InvoiceSchemaDictionaryDocument> {
    try {
      const updateFields: Record<string, unknown> = { updated_by: updatedBy };

      Object.keys(fieldUpdate).forEach((key) => {
        updateFields[`fields.$.${key}`] =
          fieldUpdate[key as keyof ISchemaField];
      });

      const doc = await this.model
        .findOneAndUpdate(
          { schema_id: schemaId, "fields.field_id": fieldId },
          { $set: updateFields },
          { returnDocument: 'after' },
        )
        .exec();

      if (!doc) {
        throw new AppError(404, "Schema or field not found");
      }

      return doc;
    } catch (error: unknown) {
      console.error("Error updating field:", error);
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to update field");
    }
  }

  /**
   * Remove a field from a schema
   */
  async removeField(
    schemaId: string,
    fieldId: string,
    updatedBy: string,
  ): Promise<InvoiceSchemaDictionaryDocument> {
    try {
      const doc = await this.model
        .findOneAndUpdate(
          { schema_id: schemaId },
          {
            $pull: { fields: { field_id: fieldId } },
            $set: { updated_by: updatedBy },
          },
          { returnDocument: 'after' },
        )
        .exec();

      if (!doc) {
        throw new AppError(404, "Schema dictionary not found");
      }

      return doc;
    } catch (error: unknown) {
      console.error("Error removing field:", error);
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to remove field");
    }
  }

  /**
   * Add mapping rules to a schema
   */
  async addMappingRules(
    schemaId: string,
    rules: Array<Record<string, unknown>>,
    updatedBy: string,
  ): Promise<InvoiceSchemaDictionaryDocument> {
    try {
      const doc = await this.model
        .findOneAndUpdate(
          { schema_id: schemaId },
          {
            $push: { mapping_rules: { $each: rules } },
            $set: { updated_by: updatedBy },
          },
          { returnDocument: 'after' },
        )
        .exec();

      if (!doc) {
        throw new AppError(404, "Schema dictionary not found");
      }

      return doc;
    } catch (error: unknown) {
      console.error("Error adding mapping rules:", error);
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to add mapping rules");
    }
  }

  /**
   * Set schema status
   */
  async setStatus(
    schemaId: string,
    status: SchemaStatus,
    updatedBy: string,
  ): Promise<InvoiceSchemaDictionaryDocument> {
    try {
      const doc = await this.model
        .findOneAndUpdate(
          { schema_id: schemaId },
          { $set: { status, updated_by: updatedBy } },
          { returnDocument: 'after' },
        )
        .exec();

      if (!doc) {
        throw new AppError(404, "Schema dictionary not found");
      }

      return doc;
    } catch (error: unknown) {
      console.error("Error setting status:", error);
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to set status");
    }
  }

  /**
   * Set schema as default
   */
  async setAsDefault(
    schemaId: string,
    updatedBy: string,
  ): Promise<InvoiceSchemaDictionaryDocument> {
    try {
      // Get the schema first to know its source type
      const schema = await this.findBySchemaId(schemaId);
      if (!schema) {
        throw new AppError(404, "Schema dictionary not found");
      }

      // Unset any existing default for this source type
      const escapedSourceType = (schema.source_type || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const sourceTypeRegex = new RegExp(`^${escapedSourceType}$`, 'i'); // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
      await this.model.updateMany(
        { source_type: { $regex: sourceTypeRegex }, is_default: true },
        { $set: { is_default: false } },
      );

      // Set this schema as default
      const doc = await this.model
        .findOneAndUpdate(
          { schema_id: schemaId },
          { $set: { is_default: true, updated_by: updatedBy } },
          { returnDocument: 'after' },
        )
        .exec();

      return doc!;
    } catch (error: unknown) {
      console.error("Error setting as default:", error);
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to set as default");
    }
  }

  /**
   * Delete a schema dictionary
   */
  async delete(schemaId: string): Promise<boolean> {
    try {
      const result = await this.model
        .findOneAndDelete({ schema_id: schemaId })
        .exec();
      return result !== null;
    } catch (error: unknown) {
      console.error("Error deleting schema:", error);
      throw new AppError(500, "Failed to delete schema dictionary");
    }
  }

  /**
   * Get field by field_id from a schema
   */
  async getField(
    schemaId: string,
    fieldId: string,
  ): Promise<ISchemaField | null> {
    try {
      const schema = await this.findBySchemaId(schemaId);
      if (!schema) return null;

      const field = schema.fields.find((f) => f.field_id === fieldId);
      return field || null;
    } catch (error: unknown) {
      console.error("Error getting field:", error);
      throw new AppError(500, "Failed to get field");
    }
  }

  /**
   * Get all supported source types (excluding FIRS_UBL)
   */
  async getSourceTypesSummary(): Promise<
    Array<{ id: string; source_type: string; status?: SchemaStatus; last_updated: Date }>
  > {
    try {
      const result = await this.model.aggregate([
        {
          $match: {
            source_type: { $ne: "FIRS_UBL" },
          },
        },
        { $sort: { source_type: 1, updatedAt: -1, createdAt: -1 } },
        {
          $group: {
            _id: { $toLower: "$source_type" },
            id: { $first: "$_id" },
            schema_id: { $first: "$schema_id" },
            source_type: { $first: "$source_type" },
            status: { $first: "$status" },
            last_updated: { $first: "$updatedAt" },
            created_at: { $first: "$createdAt" },
          },
        },
        { $sort: { source_type: 1 } },
      ]);

      if (Array.isArray(result) && result.length > 0) {
        return result.map((item: Record<string, unknown>) => ({
          id: String(item.id || item.schema_id || item._id || ""),
          source_type: String(item.source_type || item._id || ""),
          status: (item.status as SchemaStatus) || SchemaStatus.DRAFT,
          last_updated: (item.last_updated as Date) || (item.created_at as Date) || new Date(),
        }));
      }

      // Fallback query if aggregation returns empty or fails
      const docs = await this.model.find({ source_type: { $ne: "FIRS_UBL" } }).sort({ updatedAt: -1 }).exec();
      const seen = new Set<string>();
      const summary: Array<{ id: string; source_type: string; status?: SchemaStatus; last_updated: Date }> = [];

      for (const doc of docs) {
        const type = String(doc.source_type || "");
        const lowerType = type.toLowerCase();
        if (type && !seen.has(lowerType)) {
          seen.add(lowerType);
          summary.push({
            id: String(doc._id || doc.schema_id || ""),
            source_type: type,
            status: doc.status || SchemaStatus.DRAFT,
            last_updated: doc.updatedAt || doc.createdAt || new Date(),
          });
        }
      }

      return summary;
    } catch (error: unknown) {
      console.error("Error getting source types summary, attempting fallback:", error);
      try {
        const docs = await this.model.find({ source_type: { $ne: "FIRS_UBL" } }).sort({ updatedAt: -1 }).exec();
        const seen = new Set<string>();
        const summary: Array<{ id: string; source_type: string; status?: SchemaStatus; last_updated: Date }> = [];

        for (const doc of docs) {
          const type = String(doc.source_type || "");
          const lowerType = type.toLowerCase();
          if (type && !seen.has(lowerType)) {
            seen.add(lowerType);
            summary.push({
              id: String(doc._id || doc.schema_id || ""),
              source_type: type,
              status: doc.status || SchemaStatus.DRAFT,
              last_updated: doc.updatedAt || doc.createdAt || new Date(),
            });
          }
        }
        return summary;
      } catch (fallbackError: unknown) {
        console.error("Fallback getSourceTypesSummary failed:", fallbackError);
        return [];
      }
    }
  }

  /**
   * Clone a schema with a new ID
   */
  async clone(
    sourceSchemaId: string,
    newSchemaId: string,
    name: string,
    createdBy: string,
  ): Promise<InvoiceSchemaDictionaryDocument> {
    try {
      const source = await this.findBySchemaId(sourceSchemaId);
      if (!source) {
        throw new AppError(404, "Source schema not found");
      }

      const cloned = await this.create({
        schema_id: newSchemaId,
        name,
        description: `Cloned from ${source.name}`,
        version: "1.0.0",
        source_type: source.source_type,
        status: SchemaStatus.DRAFT,
        is_default: false,
        tenant_id: source.tenant_id,
        fields: source.fields,
        mapping_rules: source.mapping_rules,
        metadata: source.metadata,
        created_by: createdBy,
      });

      return cloned;
    } catch (error: unknown) {
      console.error("Error cloning schema:", error);
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to clone schema");
    }
  }

  /**
   * Bulk import fields from JSON array
   */
  async bulkImportFields(
    schemaId: string,
    fields: ISchemaField[],
    replaceExisting: boolean,
    updatedBy: string,
  ): Promise<InvoiceSchemaDictionaryDocument> {
    try {
      let updateQuery: Record<string, unknown>;

      if (replaceExisting) {
        updateQuery = { $set: { fields, updated_by: updatedBy } };
      } else {
        updateQuery = {
          $push: { fields: { $each: fields } },
          $set: { updated_by: updatedBy },
        };
      }

      const doc = await this.model
        .findOneAndUpdate({ schema_id: schemaId }, updateQuery, { returnDocument: 'after' })
        .exec();

      if (!doc) {
        throw new AppError(404, "Schema dictionary not found");
      }

      return doc;
    } catch (error: unknown) {
      console.error("Error bulk importing fields:", error);
      if (error instanceof AppError) throw error;
      throw new AppError(500, "Failed to bulk import fields");
    }
  }
}
