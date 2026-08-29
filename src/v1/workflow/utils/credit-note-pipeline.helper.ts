import { getNestedValue, logger } from "../../../@lib";
import { FIRSService } from "../../../@lib/adapters/firs/firs.service";
import { Currency } from "../../../@lib/adapters/firs/types";
import { AuthContext } from "../../../middlewares";
import { OutboundInvoiceDocument } from "../models";
import { OutboundInvoiceRepository } from "../repos/outbound-invoice.repo";
import { OutboundWorkflowService, TransformWorkflowService } from "../services";
import { resolveCurrencyCode } from "./transformer/utils";

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
  if (!value) {
    return [];
  }

  let list: unknown[] = [];
  if (Array.isArray(value)) {
    list = value;
  } else {
    list = [value];
  }

  const ids: string[] = [];
  for (const item of list) {
    if (!item) {
      continue;
    }

    if (typeof item === "string" || typeof item === "number") {
      const str = String(item).trim();
      if (str !== "") {
        ids.push(str);
      }
    } else if (typeof item === "object") {
      const record = item as Record<string, unknown>;
      let candidate: unknown = undefined;

      if (record.irn !== undefined) {
        candidate = record.irn;
      } else if (record.invoice_id !== undefined) {
        candidate = record.invoice_id;
      } else if (record.invoice_number !== undefined) {
        candidate = record.invoice_number;
      } else if (record.id !== undefined) {
        candidate = record.id;
      } else if (record.referenceId !== undefined) {
        candidate = record.referenceId;
      }

      if (candidate !== undefined && candidate !== null) {
        const str = String(candidate).trim();
        if (str !== "") {
          ids.push(str);
        }
      }
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
  const payloadRecord = payload as Record<string, unknown>;
  const payloadData = payload.data as Record<string, unknown> | undefined;

  // 1. Resolve ID Key
  let idKey: string | undefined = undefined;
  if (authContext?.idKeyMap) {
    if (authContext.idKeyMap[eventType]) {
      idKey = authContext.idKeyMap[eventType];
    } else {
      const underscoreEvent = eventType.replace(/\./g, "_");
      if (authContext.idKeyMap[underscoreEvent]) {
        idKey = authContext.idKeyMap[underscoreEvent];
      }
    }
  }

  // 2. Resolve Credit Note ID
  let creditNoteId: string | undefined = undefined;
  if (idKey) {
    const rawVal = getNestedValue(payload, idKey);
    if (rawVal) {
      creditNoteId = String(rawVal);
    } else if (idKey.startsWith("data.")) {
      const strippedVal = getNestedValue(payload, idKey.replace(/^data\./, ""));
      if (strippedVal) {
        creditNoteId = String(strippedVal);
      }
    }
  }

  if (!creditNoteId) {
    if (payloadData?.invoice_id) {
      creditNoteId = String(payloadData.invoice_id);
    } else if (payloadRecord.invoice_id) {
      creditNoteId = String(payloadRecord.invoice_id);
    } else if (payloadData?.invoiceId) {
      creditNoteId = String(payloadData.invoiceId);
    } else if (payloadRecord.invoiceId) {
      creditNoteId = String(payloadRecord.invoiceId);
    } else if (fallbackErpInvoiceId) {
      creditNoteId = fallbackErpInvoiceId;
    }
  }

  // 3. Resolve Reference Key
  let refKey: string | undefined = undefined;
  if (authContext?.referenceIdKeyMap) {
    if (authContext.referenceIdKeyMap[eventType]) {
      refKey = authContext.referenceIdKeyMap[eventType];
    } else {
      const underscoreEvent = eventType.replace(/\./g, "_");
      if (authContext.referenceIdKeyMap[underscoreEvent]) {
        refKey = authContext.referenceIdKeyMap[underscoreEvent];
      }
    }
  }

  // 4. Resolve Configured Reference
  let configuredRef: unknown = undefined;
  if (refKey) {
    const rawRef = getNestedValue(payload, refKey);
    if (rawRef !== undefined && rawRef !== null) {
      configuredRef = rawRef;
    } else if (refKey.startsWith("data.")) {
      configuredRef = getNestedValue(payload, refKey.replace(/^data\./, ""));
    }
  }

  if (configuredRef === undefined || configuredRef === null) {
    if (payloadData?.billing_reference !== undefined) {
      configuredRef = payloadData.billing_reference;
    } else if (payloadRecord.billing_reference !== undefined) {
      configuredRef = payloadRecord.billing_reference;
    } else if (payloadData?.referenceId !== undefined) {
      configuredRef = payloadData.referenceId;
    } else if (payloadRecord.referenceId !== undefined) {
      configuredRef = payloadRecord.referenceId;
    }
  }

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

    if (!originalInvoice) {
      throw new Error(`Original invoice not found for reference ID ${refId}`);
    }

    originalInvoices.push(originalInvoice);
    const originalTransformed = originalInvoice.metadata?.transformedInvoice as CreditNotePayload | undefined;

    let issueDate = "";
    if (originalTransformed?.issue_date) {
      issueDate = originalTransformed.issue_date;
    } else if (originalInvoice.createdAt) {
      issueDate = new Date(originalInvoice.createdAt).toISOString().slice(0, 10);
    } else {
      issueDate = new Date().toISOString().slice(0, 10);
    }

    billingReferences.push({
      irn: originalInvoice.irn,
      issue_date: issueDate,
    });
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

  const payloadData = payload.data as Record<string, unknown> | undefined;
  const fallbackOriginalInvoice = resolvedOriginals.originalInvoices[0];
  const fallbackOriginalTransformed = fallbackOriginalInvoice?.metadata?.transformedInvoice as CreditNotePayload | undefined;

  let rawLines: unknown = undefined;
  if (payloadData?.invoice_line) {
    rawLines = payloadData.invoice_line;
  } else if (payload.invoice_line) {
    rawLines = payload.invoice_line;
  }

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
        `Transformed invoice payload not found on original invoice ${fallbackOriginalInvoice.irn}`,
      );
    }
    creditNotePayload = structuredClone(fallbackOriginalTransformed);
  }

  let resolvedInvoiceTypeCode = "380";
  if (payloadData?.invoice_type_code) {
    resolvedInvoiceTypeCode = String(payloadData.invoice_type_code);
  } else if (payload.invoice_type_code) {
    resolvedInvoiceTypeCode = String(payload.invoice_type_code);
  } else if (hasLines && creditNotePayload.invoice_type_code) {
    resolvedInvoiceTypeCode = creditNotePayload.invoice_type_code;
  }

  creditNotePayload.invoice_type_code = resolvedInvoiceTypeCode.trim();
  creditNotePayload.billing_reference = resolvedOriginals.billingReferences;

  if (fallbackOriginalTransformed?.accounting_supplier_party) {
    if (!creditNotePayload.accounting_supplier_party || !creditNotePayload.accounting_supplier_party.tin) {
      creditNotePayload.accounting_supplier_party = fallbackOriginalTransformed.accounting_supplier_party;
    }
  }

  if (fallbackOriginalTransformed?.accounting_customer_party) {
    if (!creditNotePayload.accounting_customer_party || !creditNotePayload.accounting_customer_party.tin) {
      creditNotePayload.accounting_customer_party = fallbackOriginalTransformed.accounting_customer_party;
    }
  }

  if (irn) {
    creditNotePayload.irn = irn;
  }

  if (authContext && authContext.businessId) {
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

  let inputCurrency = "";
  if (creditNotePayload.document_currency_code) {
    inputCurrency = creditNotePayload.document_currency_code;
  } else if (creditNotePayload.tax_currency_code) {
    inputCurrency = creditNotePayload.tax_currency_code;
  } else if (fallbackOriginalTransformed?.document_currency_code) {
    inputCurrency = fallbackOriginalTransformed.document_currency_code;
  } else if (fallbackOriginalTransformed?.tax_currency_code) {
    inputCurrency = fallbackOriginalTransformed.tax_currency_code;
  }

  const fallbackCurrency = resolveCurrencyCode(inputCurrency, currencies);

  if (creditNotePayload.tax_currency_code) {
    creditNotePayload.tax_currency_code = resolveCurrencyCode(creditNotePayload.tax_currency_code, currencies);
  } else {
    creditNotePayload.tax_currency_code = fallbackCurrency;
  }

  if (creditNotePayload.document_currency_code) {
    creditNotePayload.document_currency_code = resolveCurrencyCode(creditNotePayload.document_currency_code, currencies);
  } else {
    creditNotePayload.document_currency_code = fallbackCurrency;
  }

  if (resolvedOriginals.creditNoteId) {
    creditNotePayload.invoice_reference = String(resolvedOriginals.creditNoteId);
  }

  creditNotePayload.tenant_id = tenantId;
  return creditNotePayload;
}
