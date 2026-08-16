import { ErpEventType } from "../../webhook/models";

export interface KeyTypeDefinition {
  keyType: string;
  name: string;
  eventType: string;
  aliases: string[];
  eventKeys: string[];
  defaultIdKey: string;
  defaultReferenceIdKey?: string;
  hasReferenceKey?: boolean;
}

export const KEY_CONFIG_REGISTRY: KeyTypeDefinition[] = [
  {
    keyType: "standard_invoice",
    name: "Standard Invoice",
    eventType: ErpEventType.INVOICE_SUBMITTED,
    aliases: ["standard", "invoice", "standard_invoice", "standard-invoice"],
    eventKeys: [ErpEventType.INVOICE_SUBMITTED, ErpEventType.INVOICE_CREATED],
    defaultIdKey: "invoiceId",
  },
  {
    keyType: "credit_note",
    name: "Credit Note",
    eventType: ErpEventType.CREDIT_NOTE_ISSUED,
    aliases: ["credit_note", "creditnote", "credit-note", "credit_notes"],
    eventKeys: [ErpEventType.CREDIT_NOTE_ISSUED, "erp.credit_note.issued"],
    defaultIdKey: "creditNote.id",
    defaultReferenceIdKey: "creditNote.originalInvoiceId",
    hasReferenceKey: true,
  },
  {
    keyType: "debit_note",
    name: "Debit Note",
    eventType: ErpEventType.DEBIT_NOTE_ISSUED,
    aliases: ["debit_note", "debitnote", "debit-note", "debit_notes"],
    eventKeys: [ErpEventType.DEBIT_NOTE_ISSUED, "erp.debit_note.issued"],
    defaultIdKey: "debitNote.id",
    defaultReferenceIdKey: "debitNote.originalInvoiceId",
    hasReferenceKey: true,
  },
  {
    keyType: "payment",
    name: "Payment",
    eventType: ErpEventType.PAYMENT_RECEIVED,
    aliases: ["payment", "payment_received", "payment-received", "payments"],
    eventKeys: [ErpEventType.PAYMENT_RECEIVED, "erp_payment_received"],
    defaultIdKey: "payment.id",
    defaultReferenceIdKey: "payment.invoiceId",
    hasReferenceKey: true,
  },
  {
    keyType: "invoice_updated",
    name: "Invoice Updated",
    eventType: ErpEventType.INVOICE_UPDATED,
    aliases: ["invoice_updated", "invoice-updated", "updated"],
    eventKeys: [ErpEventType.INVOICE_UPDATED],
    defaultIdKey: "invoiceId",
  },
  {
    keyType: "invoice_voided",
    name: "Invoice Voided",
    eventType: ErpEventType.INVOICE_VOIDED,
    aliases: ["invoice_voided", "invoice-voided", "voided"],
    eventKeys: [ErpEventType.INVOICE_VOIDED],
    defaultIdKey: "invoiceId",
  },
  {
    keyType: "invoice_canceled",
    name: "Invoice Canceled",
    eventType: ErpEventType.INVOICE_CANCELED,
    aliases: ["invoice_canceled", "invoice-canceled", "canceled"],
    eventKeys: [ErpEventType.INVOICE_CANCELED],
    defaultIdKey: "invoiceId",
  },
];

export const VALID_ERP_EVENT_TYPES: string[] = Object.values(ErpEventType);

export function isValidErpEventType(eventType?: string): boolean {
  if (!eventType) return false;
  return (
    VALID_ERP_EVENT_TYPES.includes(eventType) ||
    VALID_ERP_EVENT_TYPES.includes(eventType.replace(/_/g, ".")) ||
    VALID_ERP_EVENT_TYPES.includes(eventType.replace(/\./g, "_"))
  );
}

export function parseMapToRecord(m: any): Record<string, string> {
  if (!m) return {};
  if (typeof m.entries === "function") {
    return Object.fromEntries(m.entries());
  }
  return typeof m === "object" ? m : {};
}

export function findKeyTypeDefinition(
  keyTypeOrAlias?: string,
): KeyTypeDefinition | undefined {
  if (!keyTypeOrAlias) return undefined;
  const normalized = keyTypeOrAlias.toLowerCase().trim().replace(/[-\s]/g, "_");

  return KEY_CONFIG_REGISTRY.find(
    (def) =>
      def.keyType === normalized ||
      def.aliases.some((a) => a.replace(/[-\s]/g, "_") === normalized),
  );
}

export function resolveKeyConfig(def: KeyTypeDefinition, tenantConfig: any) {
  const idKeyMap = parseMapToRecord(tenantConfig?.idKeyMap);
  const referenceIdKeyMap = parseMapToRecord(tenantConfig?.referenceIdKeyMap);

  // 1. Search for ID key in idKeyMap across known event aliases, fallback to invoiceIdKey for standard invoices
  let idKey: string | undefined;
  for (const key of def.eventKeys) {
    const val = idKeyMap[key] || idKeyMap[key.replace(/\./g, "_")];
    if (val) {
      idKey = val;
      break;
    }
  }

  if (
    !idKey &&
    def.keyType === "standard_invoice" &&
    tenantConfig?.invoiceIdKey
  ) {
    idKey = tenantConfig.invoiceIdKey;
  }

  idKey = idKey || def.defaultIdKey;

  // 2. Search for Reference ID key in referenceIdKeyMap
  let referenceIdKey: string | null = null;
  if (def.hasReferenceKey) {
    for (const key of def.eventKeys) {
      const val =
        referenceIdKeyMap[key] || referenceIdKeyMap[key.replace(/\./g, "_")];
      if (val) {
        referenceIdKey = val;
        break;
      }
    }
    referenceIdKey = referenceIdKey || def.defaultReferenceIdKey || null;
  }

  return {
    keyType: def.keyType,
    name: def.name,
    eventType: def.eventType,
    idKey,
    ...(def.keyType === "standard_invoice" ? { invoiceIdKey: idKey } : {}),
    ...(def.hasReferenceKey ? { referenceIdKey } : {}),
  };
}
