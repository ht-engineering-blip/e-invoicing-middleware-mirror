import { z } from "zod";
import { FIRSInvoiceSchema, type FIRSInvoice } from "./schema-validator";
import type { ISchemaField, MappingTemplate } from "./mapping-spec.types";

/**
 * Definition of an NRS Schema Version
 */
export interface NRSSchemaVersionInfo {
  version: string;
  name: string;
  description: string;
  isLatest: boolean;
  zodSchema: z.ZodTypeAny;
  fields: ISchemaField[];
  requiredFields: Array<{
    path: string;
    label: string;
    dataType: string;
    description: string;
    example?: string;
  }>;
}

/**
 * Database-Driven Registry for NRS / FIRS specifications
 * Dynamically populated from the InvoiceSchemaDictionary DB collection.
 */
export class NRSSchemaRegistry {
  private static schemas: Map<string, NRSSchemaVersionInfo> = new Map();
  private static templates: Map<string, MappingTemplate> = new Map();

  /**
   * Register an ERP Mapping Template in runtime cache
   */
  static registerTemplate(template: MappingTemplate): void {
    const key = (template.erp_source || "").toUpperCase().replace(/[-\s]/g, "_");
    this.templates.set(key, template);
  }

  /**
   * Retrieve an ERP Mapping Template by ERP source key
   */
  static getTemplate(erpSource: string): MappingTemplate | undefined {
    const key = (erpSource || "").toUpperCase().replace(/[-\s]/g, "_");
    return this.templates.get(key);
  }

  /**
   * Check if a Mapping Template is registered for ERP
   */
  static hasTemplate(erpSource: string): boolean {
    const key = (erpSource || "").toUpperCase().replace(/[-\s]/g, "_");
    return this.templates.has(key);
  }

  /**
   * Helper to retrieve nested values by path (supports [0] or direct numeric indices)
   */
  static getPathValue(obj: any, path: string): any {
    if (!obj || typeof obj !== "object" || !path) return undefined;
    const cleanPath = path.replace(/\[(\d+)\]/g, ".$1").replace(/^\./, "");
    const parts = cleanPath.split(".").filter(Boolean);

    let curr: any = obj;
    for (const part of parts) {
      if (curr == null || typeof curr !== "object") return undefined;
      curr = curr[part];
    }
    return curr;
  }

  /**
   * Helper to retrieve all values matching a path that may contain array wildcards [*]
   */
  static getWildcardValues(
    obj: any,
    path: string,
  ): { arrayFound: boolean; values: any[] } {
    if (obj == null || !path) {
      return { arrayFound: false, values: [] };
    }

    const starIndex = path.indexOf("[*]");
    if (starIndex === -1) {
      const val = this.getPathValue(obj, path);
      return { arrayFound: true, values: [val] };
    }

    // There is at least one [*]
    const prefix = path.slice(0, starIndex);
    let remainder = path.slice(starIndex + 3);
    if (remainder.startsWith(".")) {
      remainder = remainder.slice(1);
    }

    const targetArray = prefix ? this.getPathValue(obj, prefix) : obj;
    if (!Array.isArray(targetArray) || targetArray.length === 0) {
      return { arrayFound: false, values: [] };
    }

    if (!remainder) {
      return { arrayFound: true, values: targetArray };
    }

    const collected: any[] = [];
    for (const item of targetArray) {
      const res = this.getWildcardValues(item, remainder);
      if (!res.arrayFound || res.values.length === 0) {
        collected.push(undefined);
      } else {
        collected.push(...res.values);
      }
    }

    return { arrayFound: true, values: collected };
  }

  /**
   * Register or update an NRS schema version directly from Database Schema Dictionary
   */
  static registerFromDB(
    version: string,
    name: string,
    description: string,
    fields: ISchemaField[],
    isLatest: boolean = true,
  ): NRSSchemaVersionInfo {
    const requiredFields = (fields || [])
      .filter(
        (f) =>
          f.is_required ||
          (f.validation_rules && f.validation_rules.includes("required")),
      )
      .map((f) => ({
        path: f.field_path || f.field_id,
        label: f.description || f.field_id,
        dataType: String(f.data_type || "String"),
        description: f.description || "",
        example: f.example_value ? String(f.example_value) : undefined,
      }));

    const schemaInfo: NRSSchemaVersionInfo = {
      version,
      name,
      description,
      isLatest,
      zodSchema: FIRSInvoiceSchema,
      fields: fields || [],
      requiredFields,
    };

    this.schemas.set(version.toLowerCase(), schemaInfo);
    return schemaInfo;
  }

  /**
   * Get schema metadata and validator by version string
   */
  static getSchema(version: string = "v1.0"): NRSSchemaVersionInfo | undefined {
    const normalized = version.trim().toLowerCase();
    return this.schemas.get(normalized) || this.schemas.get(version);
  }

  /**
   * Clear all registered schemas (useful for test isolation)
   */
  static clear(): void {
    this.schemas.clear();
  }

  /**
   * List all currently registered DB schema versions
   */
  static listSchemas(): Array<Omit<NRSSchemaVersionInfo, "zodSchema">> {
    return Array.from(this.schemas.values()).map(
      ({ zodSchema, ...rest }) => rest,
    );
  }

  /**
   * Validate a payload dynamically against the schema fields loaded from the DB
   */
  static validate(
    payload: unknown,
    version: string = "v1.0",
    dbFields?: ISchemaField[],
  ): {
    success: boolean;
    data?: FIRSInvoice;
    errors?: string[];
  } {
    const errors: string[] = [];
    const schemaInfo = this.getSchema(version);

    // 1. Dynamic field validation against Database Dictionary fields (Source of Truth)
    const fieldsToCheck = dbFields || schemaInfo?.fields;
    if (
      Array.isArray(fieldsToCheck) &&
      fieldsToCheck.length > 0 &&
      typeof payload === "object" &&
      payload !== null
    ) {
      for (const field of fieldsToCheck) {
        const path = field.field_path || field.field_id;
        if (!path) continue;

        // Skip system-generated fields (like IRN and business_id) that are automatically computed by the system
        if (path === "irn" || path === "business_id") {
          continue;
        }

        const isReq =
          field.is_required || field?.validation_rules?.includes("required");

        const { arrayFound, values } = this.getWildcardValues(payload, path);

        // Check required presence
        if (isReq) {
          if (!arrayFound || values.length === 0) {
            errors.push(
              `NRS DB Requirement: '${path}' (${field.description || "required field"}) is missing`,
            );
          } else {
            const hasMissingValue = values.some(
              (val) =>
                val === undefined ||
                val === null ||
                val === "" ||
                (Array.isArray(val) && val.length === 0),
            );
            if (hasMissingValue) {
              errors.push(
                `NRS DB Requirement: '${path}' (${field.description || "required field"}) is missing`,
              );
            }
          }
        }

        // Check enum constraints if defined in DB
        if (
          Array.isArray(field.enum_values) &&
          field.enum_values.length > 0 &&
          values.length > 0
        ) {
          for (const val of values) {
            if (
              val !== undefined &&
              val !== null &&
              val !== "" &&
              !field.enum_values.includes(String(val))
            ) {
              errors.push(
                `NRS DB Constraint: '${path}' value '${val}' is not in allowed list [${field.enum_values.join(", ")}]`,
              );
            }
          }
        }
      }
    } else {
      // 2. Fallback structural baseline validation
      const zodValidator = schemaInfo?.zodSchema || FIRSInvoiceSchema;
      const parsed = zodValidator.safeParse(payload);

      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          const path = issue.path.join(".");
          errors.push(path ? `${path}: ${issue.message}` : issue.message);
        }
      }
    }

    if (errors.length > 0) {
      return {
        success: false,
        errors,
      };
    }

    return {
      success: true,
      data: payload as FIRSInvoice,
    };
  }
}
