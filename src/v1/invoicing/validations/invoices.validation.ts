import { InvoiceSchema } from "../../shared/validations/models.schema";
import { t } from "elysia";
import {
  SAMPLE_INVOICE_BODY,
  generateIrnExample,
  irnOnlyExample,
  acknowledgeExample,
  statusUpdateExample,
  vatReportExample,
} from "../examples/invoices.examples";

export const generateIrnValidation = {
  body: t.Object(
    {
      invoiceNumber: t.String({
        minLength: 1,
        example: generateIrnExample.invoiceNumber,
      }),
      issueDate: t.Optional(
        t.String({ example: generateIrnExample.issueDate }),
      ),
    },
    {
      examples: [generateIrnExample],
    },
  ),
  
  detail: {
    summary: "Generate IRN",
    description:
      "Generate a unique Invoice Reference Number (IRN) for an invoice",
    tags: ["Invoicing"],
  },
};

export const transformInvoiceValidation = {
  body: t.Any({ default: {}, examples: [SAMPLE_INVOICE_BODY] }),
  
  detail: {
    summary: "Transform Invoice",
    description: "Transform invoice to FIRS UBL format",
    tags: ["Invoicing"],
  },
};

export const validateInvoiceValidation = {
  body: t.Any({ default: {}, examples: [SAMPLE_INVOICE_BODY] }),
  
  detail: {
    summary: "Validate Invoice",
    description: "Validate invoice against FIRS requirements",
    tags: ["Invoicing"],
  },
};

export const signInvoiceValidation = {
  body: t.Any({ default: {}, examples: [SAMPLE_INVOICE_BODY] }),
  
  detail: {
    summary: "Sign Invoice",
    description: "Sign the invoice using tenant FIRS credentials",
    tags: ["Invoicing"],
  },
};

export const generateQRValidation = {
  body: t.Object(
    {
      irn: t.String({ minLength: 8, example: irnOnlyExample.irn }),
    },
    {
      examples: [irnOnlyExample],
    },
  ),
  
  detail: {
    summary: "Generate QR Code",
    description: "Generate QR code for an invoice using tenant credentials",
    tags: ["Invoicing"],
  },
};

export const transmitInvoiceValidation = {
  body: t.Object(
    {
      irn: t.String({ minLength: 1, example: irnOnlyExample.irn }),
    },
    {
      examples: [irnOnlyExample],
    },
  ),
  
  detail: {
    summary: "Transmit Invoice",
    description: "Transmit signed invoice to FIRS",
    tags: ["Invoicing"],
  },
};

export const decryptInvoiceValidation = {
  body: t.Object(
    {
      irn: t.String({ minLength: 1, example: irnOnlyExample.irn }),
    },
    {
      examples: [irnOnlyExample],
    },
  ),
  
  detail: {
    summary: "Decrypt Invoice",
    description: "Download and decrypt an inbound invoice from FIRS",
    tags: ["Invoicing"],
  },
};

export const acknowledgeInvoiceValidation = {
  body: t.Object(
    {
      irn: t.String({ minLength: 1, example: acknowledgeExample.irn }),
      message: t.Optional(t.String({ example: acknowledgeExample.message })),
    },
    {
      examples: [acknowledgeExample],
    },
  ),
  
  detail: {
    summary: "Acknowledge Invoice",
    description: "Acknowledge receipt of an inbound invoice",
    tags: ["Invoicing"],
  },
};

export const updateInvoiceStatusValidation = {
  params: t.Object({
    irn: t.String({ minLength: 1 }),
  }),
  body: t.Object(
    {
      status: t.Union([
        t.Literal("PENDING"),
        t.Literal("PAID"),
        t.Literal("REJECTED"),
      ]),
      paymentDate: t.Optional(
        t.String({ example: statusUpdateExample.paymentDate }),
      ),
      paymentAmount: t.Optional(
        t.Number({ example: statusUpdateExample.paymentAmount }),
      ),
      paymentReference: t.Optional(
        t.String({ example: statusUpdateExample.paymentReference }),
      ),
      rejectionReason: t.Optional(t.String({ example: "Duplicate invoice" })),
    },
    {
      examples: [statusUpdateExample],
    },
  ),
  
  detail: {
    summary: "Update Invoice Payment Status",
    description:
      "Update the payment status of an invoice (PENDING, PAID, REJECTED)",
    tags: ["Invoicing"],
  },
};

export const reportVATValidation = {
  body: t.Object(
    {
      agent_tin: t.String({
        minLength: 1,
        description: "Accounting Supplier Party TIN",
        example: vatReportExample.agent_tin,
      }),
      base_amount: t.String({
        description: "Line extension amount (amount to be taxed)",
        example: vatReportExample.base_amount,
      }),
      beneficiary_tin: t.String({
        minLength: 1,
        description: "Accounting Buyer Party TIN",
        example: vatReportExample.beneficiary_tin,
      }),
      currency: t.String({
        default: "NGN",
        description: "Document currency code",
        example: "NGN",
      }),
      item_description: t.String({
        description: "Item description within the invoice line",
        example: vatReportExample.item_description,
      }),
      irn: t.String({
        minLength: 1,
        description: "Invoice Reference Number",
        example: vatReportExample.irn,
      }),
      other_taxes: t.String({
        description:
          "Summation of tax amount for Tax categories other than VAT",
        example: "0.00",
      }),
      total_amount: t.String({
        description: "Payable amount (amount to be collected)",
        example: vatReportExample.total_amount,
      }),
      transaction_date: t.String({
        description: "Issue date (YYYY-MM-DD)",
        example: vatReportExample.transaction_date,
      }),
      integrator_service_id: t.Optional(
        t.String({
          description:
            "Service ID of Access Point Provider (uses auth.serviceId if not provided)",
        }),
      ),
      vat_calculated: t.String({
        description:
          "Tax amount with VAT category (STANDARD_VAT, ZERO_VAT, REDUCED_VAT)",
        example: vatReportExample.vat_calculated,
      }),
      vat_rate: t.String({
        description: 'Percentage attached to tax category ID (e.g., "7.5")',
        example: "7.5",
      }),
      vat_status: t.Union(
        [
          t.Literal("STANDARD_VAT"),
          t.Literal("ZERO_VAT"),
          t.Literal("REDUCED_VAT"),
        ],
        { description: "Tax (VAT) ID related to VAT type" },
      ),
    },
    {
      examples: [vatReportExample],
    },
  ),
  
  detail: {
    summary: "Report VAT Post-Payment",
    description:
      "Report invoice to FIRS for VAT post-payment reporting (/api/v1/vat/postpayment)",
    tags: ["Invoicing"],
  },
};

export const confirmInvoiceStatusValidation = {
  params: t.Object({
    irn: t.String({ minLength: 1 }),
  }),
  
  detail: {
    summary: "Confirm Invoice Status",
    description: "Confirm the status of an invoice on FIRS",
    tags: ["Invoicing"],
  },
};

export const getDocumentTypesValidation = {
  detail: {
    summary: "Get Document Types",
    description: "Get all valid document and invoice type codes and names",
    tags: ["Invoicing"],
  },
};

