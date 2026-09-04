import { z } from "zod";
import { aiConfig } from "../../../../@config";
import { InternalServerError } from "../../../../@lib";
import { generateTransformPrompt } from "../../../../@lib/adapters/llm/prompts";
import { AuthContext } from "../../../../middlewares";
import { SchemaSourceType } from "../../models";
import { generateIRN, sanitizeInvoiceIRNs } from "./utils";
import { FIRSInvoiceSchema, type FIRSInvoice } from "./schema-validator";
export {
  FIRSInvoiceSchema,
  DateSchema,
  TimeSchema,
  PhoneSchema,
  AddressSchema,
  PartySchema,
  TaxSubtotalSchema,
  TaxTotalSchema,
  LegalMonetaryTotalSchema,
  InvoiceLineSchema,
  DocumentReferenceSchema,
} from "./schema-validator";
export type { FIRSInvoice } from "./schema-validator";
export { normalizeInvoicePayload } from "./payload-normalizer";
export { DeterministicCompleter } from "./deterministic-completer";
export { TransformerCircuitBreaker } from "./circuit-breaker";

import { sanitizeInvoicePayload } from "../invoice-sanitizer.util";

export const ALLOWED_LLM_FIELDS = new Set([
  "business_id",
  "irn",
  "issue_date",
  "issue_time",
  "due_date",
  "invoice_type_code",
  "document_currency_code",
  "invoice_kind",
  "invoice_reference",
  "invoice_number",
  "service_id",
  "accounting_supplier_party",
  "accounting_customer_party",
  "payment_means",
  "payment_terms",
  "allowance_charge",
  "tax_total",
  "legal_monetary_total",
  "invoice_line",
  "billing_reference",
  "additional_document_reference",
  "contract_document_reference",
  "originator_document_reference",
  "dispatch_document_reference",
  "receipt_document_reference",
  "order_reference",
  "notes",
]);

export function filterAllowedLLMFields(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (ALLOWED_LLM_FIELDS.has(key)) {
      filtered[key] = value;
    }
  }
  return filtered;
}

export interface TransformationResult {
  success: boolean;
  data?: FIRSInvoice;
  errors?: string[];
  validationErrors?: z.ZodError;
  rawResponse?: string;
}

export type TransformInvoiceInput = Record<string, any>;

export class FIRSInvoiceTransformer {
  private apiKey: string;
  private apiEndpoint: string;
  private provider: string;
  private model: string;

  constructor(
    apiKey: string,
    apiEndpoint: string = "https://api.openai.com/v1/chat/completions",
    provider: string = "openai",
    model: string = "gpt-4o-mini",
  ) {
    this.apiKey = apiKey;
    this.apiEndpoint = apiEndpoint || "https://api.openai.com/v1/chat/completions";
    this.provider = provider || "openai";
    this.model = model || "gpt-4o-mini";
  }

  /**
   * Main method to transform raw invoice data and validate against FIRS schema
   */
  async transformAndValidate(
    invoiceData: TransformInvoiceInput,
    authContext?: AuthContext,
    sourceType?: SchemaSourceType | string,
    autoFix: boolean = true,
  ): Promise<TransformationResult> {
    try {
      const transformedData = await this.transformWithLLM(
        invoiceData,
        authContext,
        sourceType,
      );

      const validationResult = this.validateFIRSSchema(transformedData);

      if (validationResult.success) {
        return {
          success: true,
          data: validationResult.data,
          rawResponse: JSON.stringify(transformedData),
        };
      }

      if (autoFix && validationResult.error) {
        const fixedData = this.attemptAutoFix(
          transformedData,
          validationResult.error,
        );
        const reValidationResult = this.validateFIRSSchema(fixedData);

        if (reValidationResult.success) {
          return {
            success: true,
            data: reValidationResult.data,
            rawResponse: JSON.stringify(fixedData),
          };
        }

        return {
          success: false,
          errors: this.formatValidationErrors(reValidationResult.error!),
          validationErrors: reValidationResult.error,
          rawResponse: JSON.stringify(fixedData),
        };
      }

      return {
        success: false,
        errors: this.formatValidationErrors(validationResult.error!),
        validationErrors: validationResult.error,
        rawResponse: JSON.stringify(transformedData),
      };
    } catch (error: any) {
      return {
        success: false,
        errors: [error.message || "Failed to transform invoice data"],
      };
    }
  }

  /**
   * Call LLM API to transform invoice data
   */
  private async transformWithLLM(
    invoiceData: TransformInvoiceInput,
    authContext?: AuthContext,
    sourceType?: SchemaSourceType | string,
  ): Promise<Record<string, unknown>> {
    if (
      !aiConfig?.enabled ||
      (this.provider === "openai" && !aiConfig?.openaiEnabled)
    ) {
      throw new InternalServerError(
        "OpenAI / AI transformation service is currently disabled by environment configuration (OPENAI_ENABLED=false)",
      );
    }

    const prompt = await generateTransformPrompt(
      invoiceData,
      authContext,
      (sourceType as SchemaSourceType) || SchemaSourceType.FIRS_UBL,
    );

    const isGemini =
      this.provider === "gemini" || aiConfig?.provider === "gemini";
    let body: string;
    let url: string;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (isGemini) {
      const model = this.model || aiConfig?.model || "gemini-2.0-flash";
      url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;
      body = JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      });
    } else {
      url = this.apiEndpoint;
      headers["Authorization"] = `Bearer ${this.apiKey}`;
      body = JSON.stringify({
        model: this.model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        response_format: { type: "json_object" },
      });
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new InternalServerError(`LLM API error: ${errorText}`);
    }

    const result = (await response.json()) as Record<string, unknown>;
    let content: string | undefined;

    if (isGemini) {
      const candidates = result.candidates as
        | Array<{ content?: { parts?: Array<{ text?: string }> } }>
        | undefined;
      content = candidates?.[0]?.content?.parts?.[0]?.text;
    } else {
      const choices = result.choices as
        | Array<{ message?: { content?: string } }>
        | undefined;
      content = choices?.[0]?.message?.content;
    }

    if (!content) {
      throw new Error("No content received from LLM");
    }

    let parsedContent: Record<string, unknown>;
    try {
      parsedContent = JSON.parse(content) as Record<string, unknown>;
    } catch {
      throw new Error("Failed to parse LLM response as JSON");
    }

    // 1. Allowlist fields from LLM output to prevent prompt injection / unrecognized payload structures
    let sanitizedContent = filterAllowedLLMFields(parsedContent);

    if (authContext?.businessId) {
      sanitizedContent.business_id = authContext.businessId;
    }

    if (
      !sanitizedContent.irn ||
      sanitizedContent.irn === "IRN" ||
      sanitizedContent.irn === "{{TEST_BUSINESS_ID}}"
    ) {
      sanitizedContent.irn = generateIRN(
        String(sanitizedContent.invoice_reference || invoiceData.invoiceNumber),
        authContext?.serviceId,
        new Date(),
      );
    }

    // 2. Re-derive financial totals & sanitize schema structures from source line items
    sanitizedContent = sanitizeInvoicePayload(sanitizedContent);

    sanitizeInvoiceIRNs(sanitizedContent);
    return sanitizedContent;
  }

  /**
   * Validate transformed data against FIRS schema
   */
  validateFIRSSchema(
    data: unknown,
  ):
    | { success: true; data: FIRSInvoice; error?: undefined }
    | { success: false; data?: undefined; error: z.ZodError } {
    const result = FIRSInvoiceSchema.safeParse(data);
    if (result.success) {
      return { success: true, data: result.data };
    } else {
      return { success: false, error: result.error };
    }
  }

  /**
   * Attempt to automatically fix common validation errors
   */
  private attemptAutoFix(
    data: Record<string, unknown>,
    errors: z.ZodError,
  ): Record<string, unknown> {
    const fixed: Record<string, unknown> = { ...data };

    for (const issue of errors.issues) {
      const path = issue.path.join(".");

      if (issue.code === "invalid_type" && issue.expected === "string") {
        if (path === "business_id") {
          fixed.business_id = "{{TEST_BUSINESS_ID}}";
        } else if (path === "issue_date") {
          fixed.issue_date = new Date().toISOString().slice(0, 10);
        } else if (path === "invoice_type_code") {
          const original = String(data.invoice_type_code || "");
          if (original === "381" || original === "380" || original === "384") {
            fixed.invoice_type_code = original;
          } else {
            fixed.invoice_type_code = "396";
          }
        } else if (path === "document_currency_code") {
          fixed.document_currency_code = "NGN";
        }
      }

      if (
        path === "tax_total" &&
        (!fixed.tax_total || !Array.isArray(fixed.tax_total))
      ) {
        fixed.tax_total = [
          {
            tax_amount: 0,
            tax_subtotal: [
              {
                taxable_amount: 0,
                tax_amount: 0,
                tax_category: {
                  id: "ZERO_VAT",
                  percent: 0,
                },
              },
            ],
          },
        ];
      }
    }

    return fixed;
  }

  private formatValidationErrors(errors: z.ZodError): string[] {
    return errors.issues.map((issue) => {
      const path = issue.path.join(".");
      return `${path}: ${issue.message}`;
    });
  }
}
