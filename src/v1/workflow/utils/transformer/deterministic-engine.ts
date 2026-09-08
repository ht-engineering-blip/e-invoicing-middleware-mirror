import { DeterministicCompleter } from "./deterministic-completer";
import {
  ArrayMappingRule,
  AuthContext,
  DeterministicTransformResult,
  FieldMappingRule,
  MappingTemplate,
} from "./mapping-spec.types";
import { NRSSchemaRegistry } from "./nrs-schema-registry";
import { sanitizeHsnCode } from "./classification.helper";
import { sanitizePriceUnit } from "./utils";

export class DeterministicMappingEngine {
  private static pathCache = new Map<string, string[]>();

  /**
   * Fast split & clean of path with LRU-style bounded in-memory cache
   */
  static getPathParts(path: string): string[] {
    if (!path) return [];
    let parts = this.pathCache.get(path);
    if (!parts) {
      const cleanPath = path.replace(/\[(\d+)\]/g, ".$1").replace(/^\./, "");
      parts = cleanPath.split(".").filter(Boolean);
      if (this.pathCache.size > 2000) this.pathCache.clear();
      this.pathCache.set(path, parts);
    }
    return parts;
  }

  /**
   * Safe, ultra-fast retrieval of nested value by pre-parsed or string path
   */
  static getValue(obj: unknown, path: string | string[]): unknown {
    if (!obj || typeof obj !== "object") return undefined;
    const parts = Array.isArray(path) ? path : this.getPathParts(path);

    let curr: any = obj;
    for (let i = 0; i < parts.length; i++) {
      if (curr == null || typeof curr !== "object") return undefined;
      curr = curr[parts[i]];
    }
    return curr;
  }

  /**
   * Safe, ultra-fast assignment of nested value into destination object
   */
  static setValue(
    targetObj: Record<string, any>,
    path: string | string[],
    value: unknown,
  ): void {
    if (!targetObj || typeof targetObj !== "object") return;
    const parts = Array.isArray(path) ? path : this.getPathParts(path);
    if (parts.length === 0) return;

    let curr: any = targetObj;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      const nextPart = parts[i + 1];

      if (part === "__proto__" || part === "constructor" || part === "prototype") {
        return;
      }

      if (curr[part] == null || typeof curr[part] !== "object") {
        curr[part] = /^\d+$/.test(nextPart) ? [] : {};
      }
      curr = curr[part];
    }

    const lastPart = parts[parts.length - 1];
    if (
      lastPart !== "__proto__" &&
      lastPart !== "constructor" &&
      lastPart !== "prototype"
    ) {
      curr[lastPart] = value;
    }
  }

  /**
   * Applies built-in transformations to a value
   */
  static applyTransform(value: unknown, transformName?: string): unknown {
    if (value === undefined || value === null) return value;
    if (!transformName) return value;

    const op = transformName.trim();

    if (op === "toString") {
      return String(value);
    }

    if (op === "toNumber") {
      return DeterministicCompleter.toFloat(value, 0);
    }

    if (op === "toBoolean") {
      if (typeof value === "boolean") return value;
      const str = String(value).toLowerCase().trim();
      return str === "true" || str === "1" || str === "yes";
    }

    if (op === "trim") {
      return typeof value === "string" ? value.trim() : value;
    }

    if (op === "uppercase") {
      return typeof value === "string" ? value.toUpperCase().trim() : value;
    }

    if (op === "lowercase") {
      return typeof value === "string" ? value.toLowerCase().trim() : value;
    }

    if (op.startsWith("toDate")) {
      try {
        const str = String(value).trim();
        if (/^\d{8}$/.test(str)) {
          return `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}`;
        }
        const d = new Date(str);
        if (!isNaN(d.getTime())) {
          return d.toISOString().slice(0, 10);
        }
      } catch (_) {}
      return String(value);
    }

    if (op.startsWith("toTime")) {
      try {
        const str = String(value).trim();
        if (/^\d{2}:\d{2}(:\d{2})?$/.test(str)) {
          return str.length === 5 ? `${str}:00` : str;
        }
        const d = new Date(str);
        if (!isNaN(d.getTime())) {
          return d.toTimeString().slice(0, 8);
        }
      } catch (_) {}
      return String(value);
    }

    if (op === "sanitizePhone") {
      const str = String(value).trim();
      if (!str) return undefined;
      return str.startsWith("+") ? str : `+${str.replace(/[^0-9]/g, "")}`;
    }

    if (op === "sanitizeHsn") {
      return sanitizeHsnCode(value);
    }

    if (op === "sanitizePriceUnit") {
      return sanitizePriceUnit(String(value));
    }

    return value;
  }

  /**
   * Resolves a value from source payload using pre-parsed paths, fallbacks, and static default
   */
  static resolveFieldValue(
    sourcePayload: Record<string, any>,
    rule: FieldMappingRule,
  ): unknown {
    let resolved: unknown = undefined;

    // 1. Try primary source path
    if (rule.source) {
      resolved = this.getValue(sourcePayload, rule.source);
    }

    // 2. Try fallback sources if primary is empty/null/undefined
    if (
      (resolved === undefined || resolved === null || resolved === "") &&
      Array.isArray(rule.fallback_sources)
    ) {
      for (let i = 0; i < rule.fallback_sources.length; i++) {
        const candidate = this.getValue(sourcePayload, rule.fallback_sources[i]);
        if (candidate !== undefined && candidate !== null && candidate !== "") {
          resolved = candidate;
          break;
        }
      }
    }

    // 3. Apply default value if still empty
    if (
      (resolved === undefined || resolved === null || resolved === "") &&
      rule.default_value !== undefined
    ) {
      resolved = rule.default_value;
    }

    // 4. Apply transformation
    if (resolved !== undefined && resolved !== null) {
      resolved = this.applyTransform(resolved, rule.transform);
    }

    return resolved;
  }

  /**
   * Highly optimized array mapping for high volume line items (1000+ items)
   */
  static mapArray(
    sourcePayload: Record<string, any>,
    arrayRule: ArrayMappingRule,
  ): any[] {
    const rawArray = this.getValue(sourcePayload, arrayRule.source_array);
    if (!Array.isArray(rawArray) || rawArray.length === 0) {
      return [];
    }

    const len = rawArray.length;
    const mapped: any[] = new Array(len);
    const itemMappings = arrayRule.item_mappings;
    const mappingCount = itemMappings.length;

    // Pre-cache item mapping tokenized paths
    const precompiledRules = itemMappings.map((r) => ({
      rule: r,
      targetParts: this.getPathParts(r.target),
      sourceParts: r.source ? this.getPathParts(r.source) : undefined,
    }));

    for (let i = 0; i < len; i++) {
      const item = rawArray[i];
      const targetItem: Record<string, any> = {};

      for (let j = 0; j < mappingCount; j++) {
        const compiled = precompiledRules[j];
        const val = this.resolveFieldValue(item, compiled.rule);
        if (val !== undefined && val !== null) {
          this.setValue(targetItem, compiled.targetParts, val);
        }
      }
      mapped[i] = targetItem;
    }

    return mapped;
  }

  /**
   * Executes deterministic transformation against an inbound payload
   */
  static transform(
    inboundPayload: Record<string, any>,
    template: MappingTemplate,
    authContext?: AuthContext,
  ): DeterministicTransformResult {
    const startTime = performance.now();
    const resultData: Record<string, any> = {};
    const appliedRules: string[] = [];
    const missingRequired: string[] = [];

    // 1. Apply Top-Level Constants
    if (template.constants) {
      for (const [key, val] of Object.entries(template.constants)) {
        this.setValue(resultData, key, val);
      }
    }

    // 2. Apply Top-Level Field Mappings
    if (Array.isArray(template.field_mappings)) {
      for (let i = 0; i < template.field_mappings.length; i++) {
        const rule = template.field_mappings[i];
        const value = this.resolveFieldValue(inboundPayload, rule);
        if (value !== undefined && value !== null && value !== "") {
          this.setValue(resultData, rule.target, value);
          appliedRules.push(rule.target);
        } else if (rule.is_required) {
          missingRequired.push(rule.target);
        }
      }
    }

    // 3. Apply Array Mappings (Optimized for 1000+ line items)
    if (Array.isArray(template.array_mappings)) {
      for (let i = 0; i < template.array_mappings.length; i++) {
        const arrayRule = template.array_mappings[i];
        const mappedItems = this.mapArray(inboundPayload, arrayRule);
        if (mappedItems.length > 0) {
          this.setValue(resultData, arrayRule.target_array, mappedItems);
          appliedRules.push(arrayRule.target_array);
        } else if (arrayRule.min_items && arrayRule.min_items > 0) {
          missingRequired.push(
            `${arrayRule.target_array} (min ${arrayRule.min_items} items)`,
          );
        }
      }
    }

    // 4. Auto-Reconciliation & Math Healing using DeterministicCompleter
    const reconciled = DeterministicCompleter.reconcileAndComplete(
      resultData,
      authContext,
    );

    const healedOutput = reconciled.completedData;
    const healedFields = reconciled.adjustmentsMade;

    // 5. Validation against Target NRS Schema Version
    const targetVersion = template.nrs_schema_version || "v1.0";
    const validation = NRSSchemaRegistry.validate(healedOutput, targetVersion);

    const executionTime = performance.now() - startTime;

    if (missingRequired.length > 0) {
      return {
        success: false,
        data: healedOutput,
        errors: missingRequired.map((f) => `Missing required field: ${f}`),
        missingRequiredFields: missingRequired,
        appliedRulesCount: appliedRules.length,
        healedFields,
        executionTimeMs: Math.round(executionTime * 100) / 100,
      };
    }

    if (!validation.success) {
      return {
        success: false,
        data: healedOutput,
        errors: validation.errors,
        missingRequiredFields: missingRequired,
        appliedRulesCount: appliedRules.length,
        healedFields,
        executionTimeMs: Math.round(executionTime * 100) / 100,
      };
    }

    return {
      success: true,
      data: validation.data as Record<string, any>,
      appliedRulesCount: appliedRules.length,
      healedFields,
      executionTimeMs: Math.round(executionTime * 100) / 100,
    };
  }
}
