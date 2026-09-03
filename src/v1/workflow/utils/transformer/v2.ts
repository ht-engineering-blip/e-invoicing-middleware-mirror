import { z } from "zod";
import { aiConfig } from "../../../../@config";
import {
  FIRSInvoiceSchema,
  TransformationResult,
  TransformInvoiceInput,
  filterAllowedLLMFields,
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

      const transformedData = result.data;
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
      let invoiceRef: string;
      if (
        typeof invoice.invoice_reference === "string" &&
        invoice.invoice_reference.trim() !== ""
      ) {
        invoiceRef = invoice.invoice_reference.trim();
      } else {
        invoiceRef = generateInvoiceRef();
      }

      let issueDate: Date | undefined;
      if (
        typeof invoice.issue_date === "string" &&
        invoice.issue_date.trim() !== ""
      ) {
        issueDate = new Date(invoice.issue_date);
      } else {
        issueDate = undefined;
      }

      let serviceId: string | undefined;
      if (authContext?.serviceId) {
        serviceId = authContext.serviceId;
      }

      const computedIrn = generateIRN(invoiceRef, serviceId, issueDate);

      let expectedIrn: string | undefined;
      if (typeof invoice.irn === "string" && invoice.irn.trim() !== "") {
        expectedIrn = invoice.irn.trim();
      } else {
        expectedIrn = computedIrn;
      }

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
        const rawParsed = this.safeParseLLMJSON(response);
        const parsed = filterAllowedLLMFields(rawParsed) as Record<string, any>;

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
        try {
          const repaired = await this.repairJSON(
            completed,
            validation.errors,
            authContext,
            sourceSchema,
            taxCategories,
            invoiceTypes,
          );
          if (repaired && typeof repaired === "object") {
            completed = repaired;
          }
        } catch (repairErr: unknown) {
          logger.warn(
            "[TransformerV2] Repair JSON attempt warning:",
            repairErr,
          );
        }
      }

      const toFloat = (val: unknown, fallback: number = 0): number => {
        if (typeof val === "number") return isNaN(val) ? fallback : val;
        if (typeof val === "string") {
          const cleaned = val.replace(/[^0-9.-]+/g, "");
          const num = Number(cleaned);
          return isNaN(num) ? fallback : num;
        }
        return fallback;
      };

      if (Array.isArray(completed.invoice_line)) {
        for (const line of completed.invoice_line as Record<string, any>[]) {
          if (!line) continue;

          // 1. Ensure item object exists
          if (!line.item || typeof line.item !== "object") {
            line.item = {};
          }

          // 2. Resolve item name using if/else
          let itemName = "General Item";
          if (
            typeof line.item.name === "string" &&
            line.item.name.trim() !== ""
          ) {
            itemName = line.item.name.trim();
          } else if (typeof line.name === "string" && line.name.trim() !== "") {
            itemName = line.name.trim();
          } else if (
            typeof line.product_category === "string" &&
            line.product_category.trim() !== ""
          ) {
            itemName = line.product_category.trim();
          }
          line.item.name = itemName;

          // 3. Resolve item description using if/else
          let itemDesc = itemName;
          if (
            typeof line.item.description === "string" &&
            line.item.description.trim() !== ""
          ) {
            itemDesc = line.item.description.trim();
          } else if (
            typeof line.description === "string" &&
            line.description.trim() !== ""
          ) {
            itemDesc = line.description.trim();
          }
          line.item.description = itemDesc;

          // 4. Resolve product category using if/else
          if (
            typeof line.product_category === "string" &&
            line.product_category.trim() !== ""
          ) {
            line.product_category = line.product_category.trim();
          } else if (
            typeof line.service_category === "string" &&
            line.service_category.trim() !== ""
          ) {
            line.product_category = line.service_category.trim();
          } else if (itemName && itemName !== "General Item") {
            line.product_category = itemName;
          } else {
            line.product_category = "General Goods and Services";
          }

          // 5. Resolve price structure & UN/ECE price unit using if/else
          if (
            typeof line.price === "number" ||
            typeof line.price === "string"
          ) {
            line.price = {
              price_amount: toFloat(line.price),
              base_quantity: 1,
              price_unit: "H87",
            };
          } else if (line.price && typeof line.price === "object") {
            line.price.price_amount = toFloat(line.price.price_amount);
            line.price.base_quantity = toFloat(line.price.base_quantity, 1);
            const rawUnit =
              typeof line.price.price_unit === "string"
                ? line.price.price_unit.trim()
                : "";
            if (
              !rawUnit ||
              rawUnit.length > 3 ||
              /NGN|USD|EUR|GBP|PER|\//i.test(rawUnit) ||
              !/^[A-Z0-9]{1,3}$/i.test(rawUnit)
            ) {
              line.price.price_unit = "H87";
            } else {
              line.price.price_unit = rawUnit.toUpperCase();
            }
          } else {
            line.price = {
              price_amount: toFloat(line.line_extension_amount),
              base_quantity: 1,
              price_unit: "H87",
            };
          }

          // 6. Coerce invoiced quantity and calculate line extension amount
          line.invoiced_quantity = toFloat(line.invoiced_quantity, 1);
          line.line_extension_amount = toFloat(
            line.line_extension_amount,
            line.invoiced_quantity * line.price.price_amount,
          );

          if (line.discount_rate !== undefined) {
            line.discount_rate = toFloat(line.discount_rate);
          }
          if (line.discount_amount !== undefined) {
            line.discount_amount = toFloat(line.discount_amount);
          }
          if (line.fee_rate !== undefined) {
            line.fee_rate = toFloat(line.fee_rate);
          }
          if (line.fee_amount !== undefined) {
            line.fee_amount = toFloat(line.fee_amount);
          }
        }
      }

      if (
        completed.legal_monetary_total &&
        typeof completed.legal_monetary_total === "object"
      ) {
        const lmt = completed.legal_monetary_total as Record<string, any>;
        lmt.line_extension_amount = toFloat(lmt.line_extension_amount);
        lmt.tax_exclusive_amount = toFloat(lmt.tax_exclusive_amount);
        lmt.tax_inclusive_amount = toFloat(lmt.tax_inclusive_amount);
        lmt.payable_amount = toFloat(lmt.payable_amount);
        if (lmt.prepaid_amount !== undefined)
          lmt.prepaid_amount = toFloat(lmt.prepaid_amount);
        if (lmt.allowance_total_amount !== undefined)
          lmt.allowance_total_amount = toFloat(lmt.allowance_total_amount);
        if (lmt.charge_total_amount !== undefined)
          lmt.charge_total_amount = toFloat(lmt.charge_total_amount);
      }

      if (Array.isArray(completed.tax_total)) {
        for (const tt of completed.tax_total as Record<string, any>[]) {
          if (!tt) continue;
          tt.tax_amount = toFloat(tt.tax_amount);
          if (Array.isArray(tt.tax_subtotal)) {
            for (const st of tt.tax_subtotal as Record<string, any>[]) {
              if (!st) continue;
              st.taxable_amount = toFloat(st.taxable_amount);
              st.tax_amount = toFloat(st.tax_amount);
              if (!st.tax_category || typeof st.tax_category !== "object") {
                st.tax_category = {};
              }
              const percentNum = toFloat(st.tax_category.percent, 7.5);
              st.tax_category.percent = percentNum;

              const validFirsCategories = [
                "STANDARD_VAT",
                "ZERO_VAT",
                "EXEMPT_VAT",
                "REDUCED_VAT",
                "STANDARD_GST",
                "REDUCED_GST",
                "ZERO_GST",
                "ALCOHOL_EXCISE_TAX",
                "TOBACCO_EXCISE_TAX",
                "FUEL_EXCISE_TAX",
                "IMPORT_DUTY",
                "EXPORT_DUTY",
                "LUXURY_TAX",
                "SERVICE_TAX",
                "TOURISM_TAX",
              ];

              let rawCatId = "";
              if (typeof st.tax_category.id === "string") {
                rawCatId = st.tax_category.id.trim().toUpperCase();
              }

              if (
                !rawCatId ||
                rawCatId === "LOCAL_SALES_TAX" ||
                rawCatId === "STATE_SALES_TAX" ||
                rawCatId === "VAT" ||
                rawCatId === "TAX" ||
                !validFirsCategories.includes(rawCatId)
              ) {
                if (percentNum === 0) {
                  st.tax_category.id = "ZERO_VAT";
                } else if (percentNum > 0 && percentNum < 7.5) {
                  st.tax_category.id = "REDUCED_VAT";
                } else {
                  st.tax_category.id = "STANDARD_VAT";
                }
              } else {
                st.tax_category.id = rawCatId;
              }
            }
          }
        }
      }

      if (Array.isArray(completed.allowance_charge)) {
        for (const ac of completed.allowance_charge as Record<string, any>[]) {
          if (!ac) continue;
          ac.amount = toFloat(ac.amount);
        }
      }

      const finalValidation = this.validateWithZod(completed, firsZodSchema);
      if (!finalValidation.valid) {
        logger.warn(
          "[TransformerV2] Final schema validation notice:",
          finalValidation.errors,
        );
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
    obj: Record<string, any>,
    path: string,
    value: unknown,
  ): void {
    if (!obj || typeof obj !== "object" || !path || typeof path !== "string") return;
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

      // nosemgrep: javascript.lang.security.audit.prototype-pollution.prototype-pollution-loop.prototype-pollution-loop
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
      // nosemgrep: javascript.lang.security.audit.prototype-pollution.prototype-pollution-loop.prototype-pollution-loop
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

    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      return undefined;
    }

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

    const rawParsed = this.safeParseLLMJSON(response);
    const parsed = filterAllowedLLMFields(rawParsed);

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
