import { getNestedValue } from "../../../@lib";
import { FIRSService } from "../../../@lib/adapters/firs/firs.service";
import { Currency } from "../../../@lib/adapters/firs/types";
import { AuthContext } from "../../../middlewares";
import { OutboundInvoiceDocument } from "../models";
import { OutboundInvoiceRepository } from "../repos/outbound-invoice.repo";
import { TransformWorkflowService } from "../services";
import { resolveCurrencyCode } from "./transformer/utils";
import { InvoiceTypeCode } from "./invoice-type";

export interface BillingReferenceItem {
  irn: string;
  issue_date: string;
}

export interface CreditNotePartyAddress {
  street_name?: string;
  city_name?: string;
  postal_zone?: string;
  lga?: string;
  state?: string;
  country?: string;
}

export interface CreditNoteParty {
  party_name?: string;
  tin?: string;
  email?: string;
  telephone?: string;
  business_description?: string;
  postal_address?: CreditNotePartyAddress;
}

export interface CreditNotePayload {
  irn?: string;
  business_id?: string;
  issue_date?: string;
  issue_time?: string;
  invoice_type_code?: string;
  invoice_kind?: string;
  payment_status?: string;
  document_currency_code?: string;
  tax_currency_code?: string;
  invoice_reference?: string;
  billing_reference?: BillingReferenceItem[];
  accounting_supplier_party?: CreditNoteParty;
  accounting_customer_party?: CreditNoteParty;
  tenant_id?: string;
  [key: string]: unknown;
}

export interface ResolvedOriginalInvoices {
  originalInvoices: OutboundInvoiceDocument[];
  billingReferences: BillingReferenceItem[];
  creditNoteId?: string;
}

export function extractReferenceIds(value: unknown): string[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  const ids: string[] = [];

  for (const item of list) {
    if (!item) continue;
    if (typeof item === "string" || typeof item === "number") {
      const str = String(item).trim();
      if (str) ids.push(str);
    } else if (typeof item === "object") {
      const rec = item as Record<string, unknown>;
      const id = rec.irn ?? rec.invoice_id ?? rec.id;
      if (id) ids.push(String(id).trim());
    }
  }

  return ids;
}

export async function resolveOriginalInvoices(
  payload: Record<string, unknown>,
  authContext: AuthContext | undefined,
  eventType: string,
  tenantId: string,
  outboundRepo: OutboundInvoiceRepository,
  fallbackErpInvoiceId?: string,
): Promise<ResolvedOriginalInvoices> {
  const dataObj =
    (payload.data as Record<string, unknown> | undefined) ?? payload;

  // 1. Resolve Credit Note ID
  const idKey =
    authContext?.idKeyMap?.[eventType] ??
    authContext?.idKeyMap?.[eventType.replace(/\./g, "_")];

  const creditNoteId =
    String(
      (idKey ? getNestedValue(payload, idKey) : null) ??
        dataObj.invoice_id ??
        dataObj.id ??
        fallbackErpInvoiceId ??
        "",
    ).trim() || undefined;

  // 2. Resolve Billing Reference
  const refKey =
    authContext?.referenceIdKeyMap?.[eventType] ??
    authContext?.referenceIdKeyMap?.[eventType.replace(/\./g, "_")];

  const configuredRef =
    (refKey ? getNestedValue(payload, refKey) : null) ??
    dataObj.billing_reference;

  const referenceIds = extractReferenceIds(configuredRef);

  if (referenceIds.length === 0) {
    throw new Error(
      "Missing billing reference or reference ID in credit note payload",
    );
  }

  const billingReferences: BillingReferenceItem[] = [];
  const originalInvoices: OutboundInvoiceDocument[] = [];

  for (const refId of referenceIds) {
    let originalInvoice = await outboundRepo.findOne({
      tenantId: { _eq: tenantId },
      erpInvoiceId: { _eq: String(refId) },
    });

    if (!originalInvoice) {
      originalInvoice = await outboundRepo.findByIrn(String(refId), tenantId);
    }

    if (originalInvoice) {
      originalInvoices.push(originalInvoice);
      const originalTransformed = originalInvoice.metadata
        ?.transformedInvoice as CreditNotePayload | undefined;

      const issueDate =
        originalTransformed?.issue_date ||
        (originalInvoice.createdAt
          ? new Date(originalInvoice.createdAt).toISOString().slice(0, 10)
          : new Date().toISOString().slice(0, 10));

      billingReferences.push({
        irn: originalInvoice.irn,
        issue_date: issueDate,
      });
    } else {
      const issueDate =
        typeof dataObj.issue_date === "string"
          ? dataObj.issue_date
          : new Date().toISOString().slice(0, 10);

      billingReferences.push({
        irn: String(refId),
        issue_date: issueDate,
      });
    }
  }

  return { originalInvoices, billingReferences, creditNoteId };
}

export async function composeCreditNotePayload(params: {
  payload: Record<string, unknown>;
  resolvedOriginals: ResolvedOriginalInvoices;
  authContext?: AuthContext;
  tenantId: string;
  irn?: string;
  sourceType?: string;
  firsService: FIRSService;
  transformService: TransformWorkflowService;
}): Promise<CreditNotePayload> {
  const {
    payload,
    resolvedOriginals,
    authContext,
    tenantId,
    irn,
    sourceType,
    firsService,
    transformService,
  } = params;

  const dataObj = (payload.data as Record<string, unknown>) ?? payload;
  const fallbackOriginalInvoice = resolvedOriginals.originalInvoices[0];
  const fallbackOriginalTransformed = fallbackOriginalInvoice?.metadata
    ?.transformedInvoice as CreditNotePayload;

  const rawLines = dataObj.invoice_line;
  const hasLines = Array.isArray(rawLines) && rawLines.length > 0;

  let creditNotePayload: CreditNotePayload;

  if (hasLines) {
    creditNotePayload = (await transformService.transformInvoiceV2(
      payload as any,
      authContext,
      sourceType,
    )) as CreditNotePayload;
  } else {
    if (!fallbackOriginalTransformed) {
      throw new Error(
        `Transformed invoice payload not found on original invoice ${fallbackOriginalInvoice?.irn || "unknown"}`,
      );
    }
    creditNotePayload = structuredClone(fallbackOriginalTransformed);
  }

  creditNotePayload.invoice_type_code = InvoiceTypeCode.CREDIT_NOTE;
  creditNotePayload.billing_reference = resolvedOriginals.billingReferences;

  if (fallbackOriginalTransformed?.accounting_supplier_party) {
    if (!creditNotePayload.accounting_supplier_party?.tin) {
      creditNotePayload.accounting_supplier_party =
        fallbackOriginalTransformed.accounting_supplier_party;
    }
  }

  if (fallbackOriginalTransformed?.accounting_customer_party) {
    if (!creditNotePayload.accounting_customer_party?.tin) {
      creditNotePayload.accounting_customer_party =
        fallbackOriginalTransformed.accounting_customer_party;
    }
  }

  if (irn) {
    creditNotePayload.irn = irn;
  }

  if (authContext?.businessId) {
    creditNotePayload.business_id = authContext.businessId;
  }

  if (!creditNotePayload.issue_date) {
    creditNotePayload.issue_date = new Date().toISOString().slice(0, 10);
  }
  if (!creditNotePayload.issue_time) {
    creditNotePayload.issue_time = new Date().toTimeString().slice(0, 8);
  }

  let currencies: Currency[] = [];
  try {
    currencies = await firsService.getResource<Currency>("currencies");
  } catch {
    // fallback gracefully
  }

  const currency = creditNotePayload.document_currency_code ?? "NGN";
  creditNotePayload.document_currency_code = resolveCurrencyCode(
    currency,
    currencies,
  );
  creditNotePayload.tax_currency_code = resolveCurrencyCode(
    creditNotePayload.tax_currency_code ?? currency,
    currencies,
  );

  if (resolvedOriginals.creditNoteId) {
    creditNotePayload.invoice_reference = String(
      resolvedOriginals.creditNoteId,
    );
  }

  creditNotePayload.tenant_id = tenantId;
  return creditNotePayload;
}
