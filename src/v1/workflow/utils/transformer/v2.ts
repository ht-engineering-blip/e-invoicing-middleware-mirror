import { z } from "zod";
import { aiConfig } from "../../../../@config";
import {
  FIRSInvoiceSchema,
  TransformationResult,
  TransformInvoiceInput,
} from ".";
import { InternalServerError, logger } from "../../../../@lib";
import { AuthContext } from "../../../../middlewares";
import { ISchemaField, SchemaSourceType } from "../../models";
import { TransformWorkflowService } from "../../services";
import {
  generateInvoiceRef,
  generateIRN,
  sanitizeInvoiceIRNs,
  setDynamicCurrencies,
  setDynamicHsCodes,
  setDynamicQuantityCodes,
} from "./utils";

import { FIRSService } from "../../../../@lib/adapters/firs/firs.service";
import {
  Currency,
  HsCode,
  InvoiceType,
  QuantityCode,
  TaxCategory,
} from "../../../../@lib/adapters/firs/types";
import {
  generateTransformPrompt,
  SYSTEM_PROMPT_V2,
} from "../../../../@lib/adapters/llm/prompts";

/* -----------------------------------------------------
 CLASS
----------------------------------------------------- */

export class FIRSInvoiceTransformerV2 {
  private apiKey: string;
  private apiEndpoint: string;
  private provider: "openai" | "gemini";
  private model: string;

  constructor(
    apiKey: string,
    apiEndpoint: string = "https://api.openai.com/v1/chat/completions",
    provider: "openai" | "gemini" = "gemini",
    model: string = "gpt-4o-mini",
  ) {
    this.apiKey = apiKey;
    this.apiEndpoint = apiEndpoint;
    this.provider = provider;
    this.model = model;
    console.log("[TransformerV2] Initialized with:", {
      endpoint: this.apiEndpoint,
      provider: this.provider,
      model: this.model,
    });
  }

  /**
   * Transformation and validation method
   * @param invoice - The raw invoice data to transform
   * @param authContext - Authentication context with tenant/business info
   * @param sourceType - The source ERP type (e.g., SAP, ORACLE, ZOHO) for schema-based transformation
   */
  async transformAndValidate(
    invoice: TransformInvoiceInput,
    authContext?: AuthContext,
    sourceType?: SchemaSourceType | string,
  ): Promise<TransformationResult | undefined> {
    const transformService = new TransformWorkflowService();

    let sourceSchema: ISchemaField[] = [];
    let mappingRules: MappingRuleItem[] = [];
    let firsSchema: ISchemaField[] = [];

    try {
      if (sourceType) {
        const sourceDoc = await transformService.getInvoiceSchema(sourceType);
        if (sourceDoc) {
          sourceSchema = sourceDoc.fields;
          mappingRules = sourceDoc.mapping_rules || [];
        }
      }

      const firsSchemaDoc = await transformService.getInvoiceSchema(
        SchemaSourceType.FIRS_UBL,
      );

      if (firsSchemaDoc) firsSchema = firsSchemaDoc.fields;

      const result = await this.transformInvoice(
        invoice,
        authContext!,
        sourceSchema,
        firsSchema,
        mappingRules,
        FIRSInvoiceSchema,
      );

      if (!result.success) {
        console.error(result.error);
        return {
          success: false,
          errors: Array.isArray(result.error)
            ? (result.error as string[])
            : [String(result.error)],
        };
      }

      const transformedData = result.data as Record<string, unknown>;
      sanitizeInvoiceIRNs(transformedData);

      const validated = this.validateWithZod(
        transformedData,
        FIRSInvoiceSchema,
      );

      if (!validated.valid) {
        console.warn("Validation failed post-transformation");
      }

      return {
        success: true,
        data: transformedData as any,
      };
    } catch (error: unknown) {
      throw new InternalServerError(
        `Transformation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /* -----------------------------------------------------
     PUBLIC TRANSFORM METHOD
    ----------------------------------------------------- */

  async transformInvoice(
    invoice: TransformInvoiceInput,
    authContext: AuthContext,
    sourceSchema: ISchemaField[],
    firsSchema: ISchemaField[],
    mappingRules: MappingRuleItem[],
    firsZodSchema: z.ZodSchema,
  ): Promise<
    | { success: true; data: Record<string, unknown> }
    | { success: false; error: unknown; originalInvoice: TransformInvoiceInput }
  > {
    try {
      const firsService = new FIRSService();
      let taxCategories: TaxCategory[] = [];
      let invoiceTypes: InvoiceType[] = [];
      let currencies: Currency[] = [];
      try {
        const [
          taxCatRes,
          invoiceTypeRes,
          qtyCodesRes,
          hsCodesRes,
          currenciesRes,
        ] = await Promise.all([
          firsService.getResource<TaxCategory>("tax-categories"),
          firsService.getResource<InvoiceType>("invoice-types"),
          firsService.getResource<QuantityCode>("invoice-quantity-codes"),
          firsService.getResource<HsCode>("hs-codes"),
          firsService.getResource<Currency>("currencies"),
        ]);
        taxCategories = taxCatRes || [];
        invoiceTypes = invoiceTypeRes || [];
        currencies = currenciesRes || [];
        if (qtyCodesRes) setDynamicQuantityCodes(qtyCodesRes);
        if (hsCodesRes) setDynamicHsCodes(hsCodesRes);
        if (currenciesRes) setDynamicCurrencies(currenciesRes);
      } catch (e) {
        console.error("Failed to fetch FIRS resources:", e);
      }

      const mapped = this.deterministicTransform(invoice, mappingRules);
      const base: Record<string, unknown> = { ...invoice, ...mapped };
      const resolved = this.ensureRequiredFields(base, firsSchema);

      const expectedBusinessId = authContext?.businessId;
      const expectedSupplierTIN = authContext?.businessTIN;
      const invoiceRef =
        (typeof invoice.invoice_reference === "string" &&
          invoice.invoice_reference) ||
        generateInvoiceRef();
      const issueDate =
        typeof invoice.issue_date === "string" && invoice.issue_date
          ? new Date(invoice.issue_date)
          : undefined;

      const serviceId =
        authContext?.serviceId || authContext?.businessId?.slice(0, 8);
      const computedIrn = generateIRN(invoiceRef, serviceId, issueDate);

      const expectedIrn =
        typeof invoice.irn === "string" && invoice.irn
          ? invoice.irn
          : computedIrn;

      if (expectedBusinessId) resolved.business_id = expectedBusinessId;
      if (expectedIrn) resolved.irn = expectedIrn;

      if (expectedSupplierTIN) {
        if (
          !resolved.accounting_supplier_party ||
          typeof resolved.accounting_supplier_party !== "object"
        ) {
          resolved.accounting_supplier_party = {};
        }
        resolved.accounting_supplier_party.tin = expectedSupplierTIN;
      }

      const missing = this.findMissingFields(resolved, firsSchema);

      let completed = resolved;
      if (missing.length > 0) {
        if (
          !aiConfig?.enabled ||
          (this.provider === "openai" && !aiConfig?.openaiEnabled)
        ) {
          return {
            success: false,
            error: `OpenAI / AI transformation service is disabled by configuration (OPENAI_ENABLED=false). Missing required fields: ${missing.join(", ")}`,
            originalInvoice: invoice,
          };
        }

        const prompt = this.buildSchemaAwarePrompt(
          resolved,
          authContext,
          sourceSchema,
          firsSchema,
          missing,
          taxCategories,
          invoiceTypes,
        );

        const response = await this.callLLM(prompt);
        const parsed = this.safeParseLLMJSON(response) as Record<
          string,
          unknown
        >;

        if (
          parsed.business_id !== undefined &&
          expectedBusinessId &&
          parsed.business_id !== expectedBusinessId
        ) {
          console.warn(
            `[TransformerV2] LLM changed business_id from "${expectedBusinessId}" to "${parsed.business_id}" — will be overwritten`,
          );
        }
        if (
          parsed.irn !== undefined &&
          expectedIrn &&
          parsed.irn !== expectedIrn
        ) {
          console.warn(
            `[TransformerV2] LLM changed irn from "${expectedIrn}" to "${parsed.irn}" — will be overwritten`,
          );
        }

        const parsedSupplier = parsed.accounting_supplier_party as
          | Record<string, unknown>
          | undefined;
        const parsedSupplierTIN = parsedSupplier?.tin;
        if (
          parsedSupplierTIN !== undefined &&
          expectedSupplierTIN &&
          parsedSupplierTIN !== expectedSupplierTIN
        ) {
          console.warn(
            `[TransformerV2] LLM changed supplier TIN from "${expectedSupplierTIN}" to "${parsedSupplierTIN}" — will be overwritten`,
          );
        }

        completed = { ...resolved, ...parsed };

        if (expectedBusinessId) {
          completed.business_id = expectedBusinessId;
        }
        if (expectedIrn) {
          completed.irn = expectedIrn;
        }
        if (expectedSupplierTIN) {
          if (
            !completed.accounting_supplier_party ||
            typeof completed.accounting_supplier_party !== "object"
          ) {
            completed.accounting_supplier_party = {};
          }
          (completed.accounting_supplier_party as Record<string, unknown>).tin =
            expectedSupplierTIN;
        }
      }

      if (!completed.issue_date) {
        completed.issue_date = new Date().toISOString().slice(0, 10);
      }
      if (!completed.issue_time) {
        completed.issue_time = new Date().toTimeString().slice(0, 8);
      }

      const validation = this.validateWithZod(completed, firsZodSchema);

      if (!validation.valid) {
        const repaired = await this.repairJSON(
          completed,
          validation.errors,
          authContext,
          sourceSchema,
          taxCategories,
          invoiceTypes,
        );

        const recheck = this.validateWithZod(repaired, firsZodSchema);

        if (!recheck.valid) {
          return {
            success: false,
            error: recheck.errors,
            originalInvoice: invoice,
          };
        }

        completed = repaired;
      }

      return {
        success: true,
        data: completed,
      };
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : "Unknown transform error";
      return {
        success: false,
        error: errorMessage,
        originalInvoice: invoice,
      };
    }
  }

  /* -----------------------------------------------------
     OBJECT UTILITIES
    ----------------------------------------------------- */

  private flattenObject(
    obj: unknown,
    prefix = "",
    res: Record<string, unknown> = {},
  ): Record<string, unknown> {
    if (obj == null || typeof obj !== "object") {
      if (prefix) res[prefix] = obj;
      return res;
    }

    const entries: [string, unknown][] = Array.isArray(obj)
      ? obj.map((v, i) => [String(i), v])
      : Object.entries(obj as Record<string, unknown>);

    for (const [key, val] of entries) {
      const prop = prefix ? `${prefix}.${key}` : key;
      if (val !== null && typeof val === "object") {
        this.flattenObject(val, prop, res);
      } else {
        res[prop] = val;
      }
    }

    return res;
  }

  private setDeepValue(
    obj: Record<string, unknown>,
    path: string,
    value: unknown,
  ): void {
    if (!path || typeof path !== "string") return;
    const keys = path
      .replace(/\[(\d+|\*)\]/g, ".$1")
      .split(".")
      .filter(Boolean);

    let current: any = obj;

    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      const nextKey = keys[i + 1];

      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        throw new Error("Prototype pollution attempt detected");
      }

      if (current[key] == null || typeof current[key] !== "object") {
        current[key] = /^\d+$/.test(nextKey) ? [] : {};
      }

      current = current[key];
    }

    const last = keys[keys.length - 1];

    if (
      last === "__proto__" ||
      last === "constructor" ||
      last === "prototype"
    ) {
      throw new Error("Prototype pollution attempt detected");
    }

    if (last === "*") {
      if (Array.isArray(current)) {
        current.forEach((_: unknown, i: number) => {
          current[i] = value;
        });
      }
    } else {
      current[last] = value;
    }
  }

  private getDeepValue(obj: unknown, path: string): unknown {
    if (!path || typeof path !== "string") return undefined;
    const keys = path
      .replace(/\[(\d+|\*)\]/g, ".$1")
      .split(".")
      .filter(Boolean);

    return this._traverseDeep(obj, keys);
  }

  private _traverseDeep(current: unknown, keys: string[]): unknown {
    if (current == null || keys.length === 0) return current;

    const [key, ...rest] = keys;

    if (key === "*") {
      if (!Array.isArray(current)) return undefined;
      const results = current
        .map((item: unknown) => this._traverseDeep(item, rest))
        .filter((v: unknown) => v !== undefined);
      return results.length === 0 ? undefined : results;
    }

    const next = (current as Record<string, unknown>)?.[key];
    return this._traverseDeep(next, rest);
  }

  private deterministicTransform(
    invoice: Record<string, unknown>,
    mappingRules: MappingRuleItem[],
  ): Record<string, unknown> {
    if (!mappingRules?.length) return {};

    const flat = this.flattenObject(invoice);
    const result: Record<string, unknown> = {};

    for (const rule of mappingRules) {
      const normalised = rule.source
        .replace(/\[(\d+|\*)\]/g, ".$1")
        .replace(/^\./, "");

      let value: unknown = flat[normalised] ?? flat[rule.source];

      if (value === undefined) {
        value = this.getDeepValue(invoice, rule.source);
      }

      if (
        Array.isArray(value) &&
        !rule.target.includes("[*]") &&
        !rule.target.includes(".*")
      ) {
        value = value[0];
      }

      if (value !== undefined) {
        this.setDeepValue(result, rule.target, value);
      }
    }

    return result;
  }

  private ensureRequiredFields(
    data: Record<string, unknown>,
    schema: ISchemaField[],
  ): Record<string, any> {
    for (const field of schema) {
      const fieldRequired =
        field.is_required || field.validation_rules?.indexOf("required") !== -1;

      if (!fieldRequired) continue;

      const path = (field.field_path || "").trim();
      if (!path) continue;

      const existing = this.getDeepValue(data, path);

      if (existing === undefined && field.default_value !== undefined) {
        this.setDeepValue(data, path, field.default_value);
      }
    }

    return data;
  }

  private isValMissing(val: unknown): boolean {
    if (val === undefined || val === null || val === "") return true;
    if (Array.isArray(val)) {
      return val.length === 0 || val.some((v) => this.isValMissing(v));
    }
    return false;
  }

  private findMissingFields(
    data: Record<string, unknown>,
    schema: ISchemaField[],
  ): string[] {
    const missing: string[] = [];

    for (const field of schema) {
      const fieldRequired =
        field.is_required || field.validation_rules?.indexOf("required") !== -1;

      if (!fieldRequired) continue;

      const path = (field.field_path || "").trim();
      if (!path) continue;

      const value = this.getDeepValue(data, path);

      if (this.isValMissing(value)) {
        missing.push(path);
      }
    }

    return missing;
  }

  private buildSchemaAwarePrompt(
    invoice: Record<string, unknown>,
    authContext: AuthContext,
    sourceSchema: ISchemaField[],
    firsSchema: ISchemaField[],
    missingFields: string[],
    taxCategories?: TaxCategory[],
    invoiceTypes?: InvoiceType[],
  ): string {
    const metaContext = `
Missing Fields Detected in Incoming Data:
${missingFields.join(", ")}
`;

    return SYSTEM_PROMPT_V2(
      invoice,
      taxCategories || [],
      invoiceTypes || [],
      authContext,
      sourceSchema,
      firsSchema,
      undefined,
      metaContext,
    );
  }

  private async callLLM(prompt: string): Promise<string> {
    if (
      !aiConfig?.enabled ||
      (this.provider === "openai" && !aiConfig?.openaiEnabled)
    ) {
      throw new InternalServerError(
        "OpenAI / AI transformation service is currently disabled by environment configuration (OPENAI_ENABLED=false)",
      );
    }
    if (this.provider === "gemini") {
      return this.callGemini(prompt);
    }
    return this.callOpenAI(prompt);
  }

  private async callGemini(prompt: string): Promise<string> {
    const model = this.model || "gemini-2.0-flash";
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      }),
    });

    const json = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;

    const candidates = json?.candidates as
      | Array<{ content?: { parts?: Array<{ text?: string }> } }>
      | undefined;
    const text = candidates?.[0]?.content?.parts?.[0]?.text;

    if (!response.ok || !text) {
      const errorMsg =
        (json?.error as { message?: string } | undefined)?.message ||
        `Gemini API failed with status ${response.status}`;
      logger.error("[TransformerV2] Gemini call failed", {
        status: response.status,
        model,
        error: json?.error || json,
      });
      throw new Error(`Gemini LLM error (${response.status}): ${errorMsg}`);
    }

    return text;
  }

  private async callOpenAI(prompt: string): Promise<string> {
    const response = await fetch(this.apiEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "You are an expert FIRS e-invoicing data transformer.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });

    const json = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const choices = json?.choices as
      | Array<{ message?: { content?: string } }>
      | undefined;
    const content = choices?.[0]?.message?.content;

    if (!response.ok || !content) {
      const errorMsg =
        (json?.error as { message?: string } | undefined)?.message ||
        `OpenAI request failed with status ${response.status}`;
      logger.error("[TransformerV2] OpenAI call failed", {
        status: response.status,
        endpoint: this.apiEndpoint,
        model: this.model,
        error: json?.error || json,
      });
      throw new Error(`OpenAI LLM error (${response.status}): ${errorMsg}`);
    }

    return content;
  }

  private safeParseLLMJSON(text: string): Record<string, unknown> {
    const cleaned = text
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    return JSON.parse(cleaned) as Record<string, unknown>;
  }

  private validateWithZod(
    data: unknown,
    schema: z.ZodSchema,
  ):
    | { valid: true; data: unknown; errors?: undefined }
    | { valid: false; data?: undefined; errors: unknown } {
    const result = schema.safeParse(data);

    if (result.success) {
      return {
        valid: true,
        data: result.data,
      };
    }

    return {
      valid: false,
      errors: result.error.flatten(),
    };
  }

  private async repairJSON(
    json: Record<string, unknown>,
    errors: unknown,
    authContext: AuthContext,
    sourceSchema: ISchemaField[],
    taxCategories: TaxCategory[],
    invoiceTypes: InvoiceType[],
  ): Promise<Record<string, unknown>> {
    const expectedBusinessId = authContext?.businessId || json.business_id;
    const supplierParty = json.accounting_supplier_party as
      | Record<string, unknown>
      | undefined;
    const expectedSupplierTIN = authContext?.businessTIN || supplierParty?.tin;
    const expectedIrn = json.irn;

    const metaContext = `\nInitial Validation Errors:\n${JSON.stringify(errors)}\n\n`;

    const systemPrompt = await generateTransformPrompt(
      json,
      authContext,
      undefined,
      sourceSchema,
      metaContext,
    );

    const userRepairPrompt = `
The JSON below failed validation.

Validation Errors to Fix:
${JSON.stringify(errors, null, 2)}

JSON to Fix:
${JSON.stringify(json, null, 2)}

Return valid, corrected JSON only following all system prompt rules.
`;

    const response = await this.callLLM(
      `${systemPrompt}\n\n${userRepairPrompt}`,
    );

    const parsed = this.safeParseLLMJSON(response);

    if (
      parsed.business_id !== undefined &&
      expectedBusinessId &&
      parsed.business_id !== expectedBusinessId
    ) {
      throw new InternalServerError(
        "LLM in repair attempted to modify the business_id identity field",
      );
    }
    if (parsed.irn !== undefined && expectedIrn && parsed.irn !== expectedIrn) {
      throw new InternalServerError(
        "LLM in repair attempted to modify the irn identity field",
      );
    }
    const parsedSupplier = parsed.accounting_supplier_party as
      | Record<string, unknown>
      | undefined;
    const parsedSupplierTIN = parsedSupplier?.tin;
    if (
      parsedSupplierTIN !== undefined &&
      expectedSupplierTIN &&
      parsedSupplierTIN !== expectedSupplierTIN
    ) {
      throw new InternalServerError(
        "LLM in repair attempted to modify the supplier TIN identity field",
      );
    }

    const repaired = { ...json, ...parsed };

    if (expectedBusinessId) {
      repaired.business_id = expectedBusinessId;
    }
    if (expectedIrn) {
      repaired.irn = expectedIrn;
    }
    if (expectedSupplierTIN) {
      if (
        !repaired.accounting_supplier_party ||
        typeof repaired.accounting_supplier_party !== "object"
      ) {
        repaired.accounting_supplier_party = {};
      }
      (repaired.accounting_supplier_party as Record<string, unknown>).tin =
        expectedSupplierTIN;
    }

    return repaired;
  }
}
