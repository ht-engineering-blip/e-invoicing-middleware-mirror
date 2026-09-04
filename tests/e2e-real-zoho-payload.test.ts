import { describe, expect, test, beforeAll } from "bun:test";
import crypto from "crypto";
import { FIRSInvoiceTransformerV2 } from "../src/v1/workflow/utils/transformer/v2";
import { DeterministicCompleter } from "../src/v1/workflow/utils/transformer/deterministic-completer";
import { TransformerCircuitBreaker } from "../src/v1/workflow/utils/transformer/circuit-breaker";
import { FIRSInvoiceSchema } from "../src/v1/workflow/utils/transformer";
import { verifyWebhookSignature, signWebhookPayload } from "../src/v1/webhook/utils/webhook-signature.helper";
import { parseXmlToJson, isXmlPayload } from "../src/v1/webhook/utils/xml-parser.helper";
import { ISchemaField } from "../src/v1/workflow/models";
import { AuthContext } from "../src/middlewares";
import { FIRSService } from "../src/@lib/adapters/firs/firs.service";
import { TransformWorkflowService } from "../src/v1/workflow/services/workflows/transform.service";
import { InboundInvoiceRepository } from "../src/v1/workflow/repos/inbound-invoice.repo";
import mongoose from "mongoose";

export interface MappingRuleItem {
  source: string;
  target: string;
  [key: string]: any;
}

// Disable Mongoose network buffering delay in tests
mongoose.set("bufferTimeoutMS", 100);
(InboundInvoiceRepository.prototype as any).create = async function (data: any) { return data as any; };

// Mock FIRSService.getResource to return immediate local static data
FIRSService.prototype.getResource = async function (endpoint: string): Promise<any[]> {
  if (endpoint === "tax-categories") return [{ id: "STANDARD_VAT", percent: 7.5 }];
  if (endpoint === "invoice-types") return [{ code: "396", name: "Tax Invoice" }];
  if (endpoint === "currencies") return [{ code: "NGN", name: "Nigerian Naira" }];
  return [];
};

// Mock TransformWorkflowService.getInvoiceSchema to bypass MongoDB connection in tests
TransformWorkflowService.prototype.getInvoiceSchema = async function () {
  return null;
};

const REAL_ZOHO_PAYLOAD = {
  "invoice": {
    "can_send_in_mail": false,
    "show_convert_to_shipment": false,
    "cf_tin": "00364075-0001",
    "early_payment_discount_amount": 0,
    "submitted_by_email": "",
    "bcy_shipping_charge_tax": "",
    "reporting_tags_ef": [],
    "tax_reg_no": "",
    "total_taxable_amount": 1,
    "stop_reminder_until_payment_expected_date": false,
    "customer_default_billing_address": {
      "zip": "87766",
      "country": "Nigeria",
      "address": "1226  Bishop Oluwole steet",
      "city": "Lagos",
      "phone": "+234-09099887766",
      "city_code": "",
      "street2": "",
      "state": "Lagos",
      "fax": "",
      "state_code": "LA"
    },
    "inprocess_transaction_present": false,
    "exchange_invoices": [],
    "cf_tin_unformatted": "00364075-0001",
    "lock_detail": {
      "can_lock": true,
      "custom_locks": [],
      "system_locks": []
    },
    "submitted_date_formatted": "",
    "estimate_id": "",
    "customer_custom_fields": [
      {
        "field_id": "8754310000009528062",
        "customfield_id": "8754310000009528062",
        "show_in_store": false,
        "show_in_portal": false,
        "is_active": true,
        "index": 1,
        "label": "TIN",
        "show_on_pdf": false,
        "edit_on_portal": false,
        "edit_on_store": false,
        "api_name": "cf_tin",
        "show_in_all_pdf": false,
        "value_formatted": "00364075-0001",
        "search_entity": "contact",
        "data_type": "string",
        "placeholder": "cf_tin",
        "value": "00364075-0001",
        "is_dependent_field": false
      }
    ],
    "status_formatted": "Draft",
    "shipping_charge_tax_id": "",
    "ecomm_operator_name": "",
    "tags": [],
    "issued_date_formatted": "",
    "is_autobill_enabled": false,
    "shipping_charge_tax_name": "",
    "in_process_payments": [],
    "discount_total": 0,
    "tax_total": 0.08,
    "write_off_amount": 0,
    "is_viewed_by_client": false,
    "discount_account_id": "",
    "salesorder_id": "",
    "shipping_charge_taxes": [],
    "sub_statuses": [],
    "last_reminder_sent_date_formatted": "",
    "account_name": "Accounts Receivable",
    "client_viewed_time_formatted": "",
    "email": "billing.ng@dimensiondata.com",
    "reason_for_debit_note": "others",
    "salesorders": [],
    "adjustment_description": "Adjustment",
    "currency_symbol": "NGN",
    "ach_supported": false,
    "locked_actions": [],
    "shipping_bills": [],
    "type_formatted": "Tax Invoice",
    "transaction_rounding_type": "no_rounding",
    "roundoff_value": 0,
    "contact_persons_details": [
      {
        "phone": "+234-0900998877",
        "mobile": "+234-08099887766",
        "last_name": "Adeife",
        "contact_person_id": "8754310000006945058",
        "is_primary_contact": true,
        "photo_url": "https://secure.gravatar.com/avatar/c756fbf51bd42dcb813b0af81b143905?&d=mm",
        "first_name": "Victor",
        "communication_preference": {
          "is_email_enabled": true
        },
        "email": "victor.adeife@heirstechnologies.com"
      }
    ],
    "template_name": "Standard Template",
    "account_id": "8754310000000000364",
    "salesorder_number": "",
    "template_id": "8754310000000017001",
    "customer_name": "Test Company",
    "total_formatted": "NGN1.08",
    "discount_total_formatted": "NGN0.00",
    "payment_terms_label": "Net 75",
    "is_reverse_charge_applied": false,
    "show_no_of_copies": true,
    "notes": "Thanks for your business.",
    "documents": [],
    "client_viewed_time": "",
    "discount_amount": 0,
    "ecomm_operator_id": "",
    "early_payment_discount_due_days": "",
    "tds_override_preference": "no_override",
    "shipping_charge_inclusive_of_tax": 0,
    "issued_date": "",
    "channel_invoice_id": "",
    "currency_formatter": {
      "decimal_separator": ".",
      "number_separator": ","
    },
    "contact": {
      "is_credit_limit_migration_completed": true,
      "unused_customer_credits_formatted": "NGN0.00",
      "credit_limit_formatted": "NGN0.00",
      "customer_balance_formatted": "NGN0.00",
      "unused_customer_credits": 0,
      "credit_limit": 0,
      "customer_balance": 0
    },
    "payment_discount_formatted": "NGN0.00",
    "invoice_id": "8754310000010306009",
    "contact_category": "",
    "template_type": "standard",
    "recurring_invoice_id": "",
    "can_send_invoice_sms": true,
    "contact_persons": [
      "8754310000006945058"
    ],
    "shipping_charge_tax": "",
    "created_time": "2026-09-04T13:59:16+0100",
    "created_date_formatted": "04 Sep 2026",
    "adjustment_account_name": "",
    "is_inclusive_tax": false,
    "reference_invoice": {
      "reference_invoice_id": ""
    },
    "early_payment_discount_amount_formatted": "NGN0.00",
    "retention_items": [],
    "price_precision": 2,
    "sub_total_inclusive_of_tax_formatted": "NGN0.00",
    "invoice_installments": [],
    "unprocessed_payment_amount": 0,
    "submitted_by_photo_url": "",
    "payment_discount": 0,
    "approvers_list": [],
    "shipping_charge_tax_percentage": "",
    "zcrm_potential_name": "",
    "adjustment": 0,
    "discount_amount_formatted": "NGN0.00",
    "current_sub_status": "draft",
    "due_date_formatted": "18 Nov 2026",
    "is_progress_invoice": false,
    "total_taxable_amount_formatted": "NGN1.00",
    "shipping_charge_inclusive_of_tax_formatted": "NGN0.00",
    "merchant_id": "",
    "invoice_source": "Client",
    "shipping_charge_exclusive_of_tax_formatted": "NGN0.00",
    "contact_persons_associated": [
      {
        "zcrm_contact_id": "",
        "phone": "+234-0900998877",
        "mobile": "+234-08099887766",
        "last_name": "Adeife",
        "contact_person_id": "8754310000006945058",
        "contact_person_name": "Victor",
        "first_name": "Victor",
        "communication_preference": {
          "is_email_enabled": true
        },
        "contact_person_email": "victor.adeife@heirstechnologies.com"
      }
    ],
    "current_sub_status_id": "",
    "custom_field_hash": {
      "cf_service_category_formatted": "Marketing",
      "cf_revenue": "True",
      "cf_invoice_kind": "B2B",
      "cf_invoice_kind_formatted": "B2B",
      "cf_service_category_unformatted": "Marketing",
      "cf_revenue_unformatted": "True",
      "cf_isic_code_unformatted": "3433",
      "cf_tax_currency_code_formatted": "NGN",
      "cf_invoice_kind_unformatted": "B2B",
      "cf_revenue_formatted": "True",
      "cf_service_category": "Marketing",
      "cf_hsn_code_formatted": "5026.80",
      "cf_isic_code_formatted": "3433",
      "cf_hsn_code": "5026.80",
      "cf_tax_currency_code": "NGN",
      "cf_tax_currency_code_unformatted": "NGN",
      "cf_hsn_code_unformatted": 5026.8,
      "cf_isic_code": "3433"
    },
    "tax_amount_withheld": 0,
    "qr_code": {
      "qr_source": "custom",
      "is_qr_enabled": true,
      "qr_value": "${invoice.cf_qrcode}",
      "qr_description": "Scan the QR code to view the configured information."
    },
    "bcy_rounding_mode": "round_half_up",
    "next_reminder_date_formatted": "",
    "shipping_charge_tax_type": "",
    "subject_content": "",
    "shipping_charge_account_name": "",
    "supply_date_formatted": "",
    "payment_expected_date": "",
    "is_emailed": false,
    "unused_retainer_payments": 0,
    "offline_created_date_with_time": "",
    "total_retention_amount": 0,
    "shipping_charge": 0,
    "bcy_adjustment": 0,
    "allow_partial_payments": false,
    "customer_custom_field_hash": {
      "cf_tin_formatted": "00364075-0001",
      "cf_tin": "00364075-0001",
      "cf_tin_unformatted": "00364075-0001"
    },
    "currency_id": "8754310000000093175",
    "includes_package_tracking_info": false,
    "zcrm_potential_id": "",
    "discount": 0,
    "taxes": [
      {
        "tax_amount": 0.08,
        "tax_name": "VAT",
        "tax_amount_formatted": "NGN0.08"
      }
    ],
    "is_client_review_settings_enabled": false,
    "billing_address": {
      "zip": "87766",
      "country": "Nigeria",
      "country_code": "NG",
      "address": "1226  Bishop Oluwole steet",
      "city": "Lagos",
      "phone": "+234-09099887766",
      "street": "1226  Bishop Oluwole steet",
      "attention": "None",
      "street2": "",
      "state": "Lagos",
      "fax": ""
    },
    "line_items": [
      {
        "actual_available_stock_formatted": "",
        "line_item_id": "8754310000010306014",
        "documents": [],
        "item_type": "sales",
        "item_type_formatted": "Sales Items (Service)",
        "discount": 0,
        "mapped_items": [],
        "package_line_items": [],
        "available_stock_formatted": "",
        "committed_stock_formatted": "",
        "internal_name": "",
        "track_serial_number": false,
        "sales_rate_formatted": "NGN1.00",
        "discounts": [],
        "project_id": "",
        "actual_available_stock": "",
        "sku": "",
        "pricing_scheme": "unit",
        "pricebook_id": "",
        "bill_id": "",
        "bcy_rate_formatted": "NGN1.00",
        "image_document_id": "",
        "actual_committed_stock_formatted": "",
        "serial_number_details": [],
        "expense_receipt_name": "",
        "item_total": 1,
        "combo_type_formatted": "",
        "tax_id": "8754310000000418713",
        "tags": [],
        "stock_on_hand": "",
        "unit": "units",
        "is_dropshipped_item": false,
        "cost_amount": 0,
        "tax_type": "tax",
        "available_for_sale_stock": "",
        "actual_available_for_sale_stock_formatted": "",
        "time_entry_ids": [],
        "cost_amount_formatted": "NGN0.00",
        "name": "Access Point",
        "line_item_tds": [],
        "combo_type": "",
        "markup_percent_formatted": "0.00%",
        "is_storage_location_enabled": false,
        "serial_numbers": [],
        "bcy_rate": 1,
        "item_total_formatted": "NGN1.00",
        "available_for_sale_stock_formatted": "",
        "is_combo_product": false,
        "salesorder_item_id": "",
        "discount_account_name": "",
        "rate_formatted": "NGN1.00",
        "header_id": "",
        "is_modifier_item": false,
        "discount_account_id": "",
        "description": "",
        "tds_tax_amount_formatted": "NGN0.00",
        "item_order": 1,
        "tds_tax_percentage": "",
        "bill_item_id": "",
        "rate": 1,
        "account_name": "Connectivity Subscription",
        "package_details": {
          "weight_unit": "kg",
          "length": "",
          "width": "",
          "weight": "",
          "dimension_unit": "cm",
          "height": ""
        },
        "actual_available_for_sale_stock": "",
        "sales_rate": 1,
        "quantity": 1,
        "item_id": "8754310000000992263",
        "reverse_charge_tax_id": "",
        "committed_stock": "",
        "track_serial_for_package": false,
        "tax_name": "VAT",
        "stock_on_hand_formatted": "",
        "tds_tax_name": "",
        "header_name": "",
        "item_custom_fields": [],
        "tds_tax_amount": 0,
        "line_item_taxes": [
          {
            "tax_amount": 0.08,
            "tax_specific_type": "tax",
            "tax_name": "VAT (7.5%)",
            "tax_amount_formatted": "NGN0.08",
            "tax_percentage": 7.5,
            "tax_id": "8754310000000418713"
          }
        ],
        "actual_committed_stock": "",
        "tds_tax_id": "",
        "markup_percent": 0,
        "account_id": "8754310000000093550",
        "tax_percentage": 7.5,
        "line_item_category": "line_item",
        "available_stock": "",
        "expense_id": ""
      }
    ],
    "can_show_kit_return": false,
    "type": "invoice",
    "credits_associated": [],
    "payment_expected_date_formatted": "",
    "balance": 1.08,
    "terms": "",
    "credits_applied": 0,
    "created_time_formatted": "04 Sep 2026 01:59 PM",
    "credits_applied_formatted": "NGN0.00",
    "invoice_number": "DDL-INV-860",
    "payment_options": {
      "payment_gateways": []
    },
    "debit_notes": [],
    "sub_total_inclusive_of_tax": 0,
    "exchange_rate": 1,
    "invoice_source_formatted": "Client",
    "approver_id": "",
    "merchant_name": "",
    "sales_channel": "direct_sales",
    "shipping_charge_formatted": "NGN0.00",
    "total_retention_amount_formatted": "NGN0.00",
    "reference_number": "23456789098765444",
    "reverse_charge_tax_total_formatted": "NGN0.00",
    "shipping_charge_account_id": "",
    "supply_date": "",
    "discount_percent": 0,
    "page_height": "11.69in",
    "status": "draft",
    "unprocessed_payment_amount_formatted": "NGN0.00",
    "reader_offline_payment_initiated": false,
    "schedule_time_formatted": "",
    "discount_account_name": "",
    "adjustment_formatted": "NGN0.00",
    "balance_formatted": "NGN1.08",
    "currency_code": "NGN",
    "page_width": "8.27in",
    "tax_override_preference": "no_override",
    "bcy_total": 1.08,
    "date_formatted": "04 Sep 2026",
    "tax_rounding": "entity_level",
    "last_modified_time": "2026-09-04T14:22:03+0100",
    "cf_tin_formatted": "00364075-0001",
    "is_kit_partial_return": false,
    "discount_type": "entity_level",
    "is_early_payment_discount_applicable": false,
    "deliverychallans": [],
    "schedule_time": "",
    "retention_override_preference": "no_override",
    "customer_id": "8754310000006945057",
    "roundoff_value_formatted": "NGN0.00",
    "unused_retainer_payments_formatted": "NGN0.00",
    "date": "2026-09-04T00:00:00.000Z",
    "submitted_date": "",
    "early_payment_discount_percentage": 0,
    "template_type_formatted": "Standard",
    "currency_name_formatted": "NGN- Nigerian Naira",
    "created_by_name": "Mary",
    "tds_summary": [],
    "last_modified_by_id": "8754310000009293041",
    "write_off_amount_formatted": "NGN0.00",
    "color_code": "",
    "bcy_tax_total": 0.08,
    "last_payment_date_formatted": "",
    "custom_fields": [
      {
        "field_id": "8754310000007133146",
        "customfield_id": "8754310000007133146",
        "show_in_store": false,
        "show_in_portal": false,
        "is_active": true,
        "index": 1,
        "label": "Revenue",
        "show_on_pdf": false,
        "edit_on_portal": false,
        "edit_on_store": false,
        "is_color_code_supported": false,
        "api_name": "cf_revenue",
        "show_in_all_pdf": false,
        "selected_option_id": "8754310000007133148",
        "value_formatted": "True",
        "search_entity": "invoice",
        "data_type": "dropdown",
        "placeholder": "cf_revenue",
        "value": "True",
        "is_dependent_field": false
      },
      {
        "field_id": "8754310000009376142",
        "customfield_id": "8754310000009376142",
        "show_in_store": false,
        "show_in_portal": false,
        "is_active": true,
        "index": 2,
        "label": "Invoice Kind",
        "show_on_pdf": false,
        "edit_on_portal": false,
        "edit_on_store": false,
        "is_color_code_supported": false,
        "api_name": "cf_invoice_kind",
        "show_in_all_pdf": false,
        "selected_option_id": "8754310000009376143",
        "value_formatted": "B2B",
        "search_entity": "invoice",
        "data_type": "dropdown",
        "placeholder": "cf_invoice_kind",
        "value": "B2B",
        "is_dependent_field": false
      },
      {
        "field_id": "8754310000009376150",
        "customfield_id": "8754310000009376150",
        "show_in_store": false,
        "show_in_portal": false,
        "is_active": true,
        "index": 3,
        "label": "Tax Currency Code",
        "show_on_pdf": false,
        "edit_on_portal": false,
        "edit_on_store": false,
        "is_color_code_supported": false,
        "api_name": "cf_tax_currency_code",
        "show_in_all_pdf": false,
        "selected_option_id": "8754310000009376152",
        "value_formatted": "NGN",
        "search_entity": "invoice",
        "data_type": "dropdown",
        "placeholder": "cf_tax_currency_code",
        "value": "NGN",
        "is_dependent_field": false
      },
      {
        "field_id": "8754310000009376157",
        "customfield_id": "8754310000009376157",
        "show_in_store": false,
        "show_in_portal": false,
        "is_active": true,
        "index": 4,
        "label": "HSN Code",
        "show_on_pdf": false,
        "edit_on_portal": false,
        "edit_on_store": false,
        "api_name": "cf_hsn_code",
        "show_in_all_pdf": false,
        "value_formatted": "5026.80",
        "search_entity": "invoice",
        "data_type": "decimal",
        "placeholder": "cf_hsn_code",
        "value": 5026.8,
        "is_dependent_field": false
      },
      {
        "field_id": "8754310000009376159",
        "customfield_id": "8754310000009376159",
        "show_in_store": false,
        "show_in_portal": false,
        "is_active": true,
        "index": 5,
        "label": "ISIC Code",
        "show_on_pdf": false,
        "edit_on_portal": false,
        "edit_on_store": false,
        "api_name": "cf_isic_code",
        "show_in_all_pdf": false,
        "value_formatted": "3433",
        "search_entity": "invoice",
        "data_type": "string",
        "placeholder": "cf_isic_code",
        "value": "3433",
        "is_dependent_field": false
      },
      {
        "field_id": "8754310000009376161",
        "customfield_id": "8754310000009376161",
        "show_in_store": false,
        "show_in_portal": false,
        "is_active": true,
        "index": 6,
        "label": "Service Category",
        "show_on_pdf": false,
        "edit_on_portal": false,
        "edit_on_store": false,
        "api_name": "cf_service_category",
        "show_in_all_pdf": false,
        "value_formatted": "Marketing",
        "search_entity": "invoice",
        "data_type": "string",
        "placeholder": "cf_service_category",
        "value": "Marketing",
        "is_dependent_field": false
      }
    ],
    "last_payment_date": "",
    "lock_details": {
      "can_lock": false
    },
    "discount_applied_on_amount_formatted": "NGN0.00",
    "exceptions": [],
    "current_sub_status_formatted": "Draft",
    "tds_calculation_type": "tds_item_level",
    "submitted_by_name": "",
    "created_by_id": "8754310000009293041",
    "is_backorder": "",
    "is_last_child_invoice": false,
    "is_discount_before_tax": true,
    "rounding_mode": "round_half_up",
    "attachment_name": "",
    "ach_payment_initiated": false,
    "last_reminder_sent_date": "",
    "payment_terms": 75,
    "shipping_charge_exclusive_of_tax": 0,
    "total": 1.08,
    "tax_total_formatted": "NGN0.08",
    "reason_for_debit_note_formatted": "Others",
    "sub_total_formatted": "NGN1.00",
    "tax_amount_withheld_formatted": "NGN0.00",
    "payment_terms_id": "",
    "bcy_shipping_charge": 0,
    "shipping_address": {
      "zip": "97766",
      "country": "Nigeria",
      "country_code": "NG",
      "address": "1226  Bishop Oluwole steet",
      "city": "Lagos",
      "phone": "+234-09099887766",
      "street": "1226  Bishop Oluwole steet",
      "attention": "None",
      "street2": "",
      "state": "Lagos",
      "fax": ""
    },
    "shipping_charge_tax_formatted": "",
    "bcy_discount_total": 0,
    "orientation": "portrait",
    "discount_applied_on_amount": 0,
    "account_identifier": "",
    "due_date": "2026-11-18T00:00:00.000Z",
    "submitter_id": "",
    "submitted_by": "",
    "no_of_copies": 1,
    "payment_made_formatted": "NGN0.00",
    "reverse_charge_tax_total": 0,
    "bcy_sub_total": 1,
    "reminders_sent": 0,
    "salesperson_name": "",
    "salesperson_id": "",
    "payment_made": 0,
    "is_inventory_valuation_pending": false,
    "show_convert_to_package": false,
    "sub_total": 1,
    "computation_type": "basic",
    "created_date": "2026-09-04T00:00:00.000Z",
    "adjustment_account_id": "",
    "invoice_url": "https://zohosecurepay.com/books/dimensiondatalimited2/secure?CInvoiceID=2-f2fb6e6dfa8705cbb17b3b57e0600a48b183a132eb2cab74b3f4b758860e45094853b0b7dde0767963dc8f377b9db9e73804b59ad4b8d748e1d4da4a15db2b4b11e80a707f5b3196 ",
    "payment_reminder_enabled": true
  }
};

describe("Comprehensive Realistic End-to-End Test Suite for Real Zoho Books Payload", () => {
  const secret = "whsec_dimensiondata_supersecret_123456";
  const mockTenant = {
    tenantId: "tenant_dimension_data_001",
    businessName: "Dimension Data Limited",
    tin: "00364075-0001",
    contactEmail: "billing.ng@dimensiondata.com",
    config: {
      erpSystem: "ZOHO",
      webhookEnabled: true,
      webhookAuth: secret,
      webhookAuthMode: "auto",
      firsCredentials: { serviceId: "34A843BE" }
    },
    metadata: {
      webhookSecretHash: crypto.createHash("sha256").update(secret).digest("hex")
    }
  };

  const zohoMappingRules: MappingRuleItem[] = [
    { source: "invoice.invoice_number", target: "id" },
    { source: "invoice.date", target: "issue_date" },
    { source: "invoice.due_date", target: "due_date" },
    { source: "invoice.currency_code", target: "document_currency_code" },
    { source: "invoice.customer_name", target: "accounting_customer_party.party_name" },
    { source: "invoice.customer_default_billing_address.address", target: "accounting_customer_party.postal_address.street_name" },
    { source: "invoice.customer_default_billing_address.city", target: "accounting_customer_party.postal_address.city_name" },
    { source: "invoice.customer_default_billing_address.state", target: "accounting_customer_party.postal_address.country_subentity" },
    { source: "invoice.cf_tin", target: "accounting_customer_party.party_tax_scheme.company_id" },
    { source: "invoice.sub_total", target: "legal_monetary_total.line_extension_amount" },
    { source: "invoice.tax_total", target: "tax_total[0].tax_amount" },
    { source: "invoice.total", target: "legal_monetary_total.payable_amount" },
    { source: "invoice.line_items[*].name", target: "invoice_line[*].item.name" },
    { source: "invoice.line_items[*].quantity", target: "invoice_line[*].invoiced_quantity" },
    { source: "invoice.line_items[*].rate", target: "invoice_line[*].price.price_amount" },
    { source: "invoice.line_items[*].item_total", target: "invoice_line[*].line_extension_amount" }
  ];

  const firsSchema: ISchemaField[] = [
    { field_path: "id", is_required: true, data_type: "string", description: "Invoice Number" } as any,
    { field_path: "issue_date", is_required: true, data_type: "string", description: "Issue Date" } as any,
    { field_path: "document_currency_code", is_required: true, data_type: "string", description: "Currency" } as any,
    { field_path: "accounting_supplier_party.party_name", is_required: true, data_type: "string", description: "Supplier Name" } as any,
    { field_path: "accounting_customer_party.party_name", is_required: true, data_type: "string", description: "Customer Name" } as any,
    { field_path: "legal_monetary_total.payable_amount", is_required: true, data_type: "number", description: "Payable Amount" } as any,
    { field_path: "invoice_line", is_required: true, data_type: "array", description: "Invoice Lines" } as any
  ];

  const authContext: AuthContext = {
    tenantId: mockTenant.tenantId,
    businessName: mockTenant.businessName,
    tin: mockTenant.tin,
    tenantERP: "ZOHO",
    tenantMappings: zohoMappingRules
  } as any;

  test("Scenario 1: End-to-End Deterministic Zero-LLM Transformation of Real Payload", async () => {
    const transformer = new FIRSInvoiceTransformerV2("fake_openai_key");
    const result = await transformer.transformInvoice(
      REAL_ZOHO_PAYLOAD,
      authContext,
      [],
      firsSchema,
      zohoMappingRules,
      FIRSInvoiceSchema
    );

    expect(result.success).toBe(true);
    if (!result.success) return;

    const data: any = result.data;
    console.log("[Test] Transformed Real Invoice Data Result:", {
      id: data.id,
      irn: data.irn,
      customerName: data.accounting_customer_party?.party_name,
      customerTIN: data.accounting_customer_party?.party_tax_scheme?.company_id,
      payableAmount: data.legal_monetary_total?.payable_amount,
      taxAmount: data.tax_total?.[0]?.tax_amount,
      lineItemsCount: data.invoice_line?.length,
      paymentMeans: data.payment_means
    });

    // Validations
    expect(data.id).toBe("DDL-INV-860");
    expect(data.irn).toContain("34A843BE");
    expect(data.document_currency_code).toBe("NGN");
    expect(data.accounting_customer_party.party_name).toBe("Test Company");
    expect(data.accounting_customer_party.party_tax_scheme.company_id).toBe("00364075-0001");
    expect(data.accounting_supplier_party.party_name).toBe("Dimension Data Limited");
    expect(data.legal_monetary_total.line_extension_amount).toBe(1.00);
    expect(data.legal_monetary_total.tax_exclusive_amount).toBe(1.00);
    expect(data.legal_monetary_total.tax_inclusive_amount).toBe(1.08);
    expect(data.legal_monetary_total.payable_amount).toBe(1.08);
    expect(data.payment_means[0].payment_means_code).toBe("10");
    expect(data.invoice_line.length).toBe(1);
    expect(data.invoice_line[0].item.name).toBe("Access Point");
    expect(data.invoice_line[0].invoiced_quantity).toBe(1);
    expect(data.invoice_line[0].price.price_amount).toBe(1.00);
  });

  test("Scenario 2: Webhook Multi-Security Auth Strategies with Real Payload", async () => {
    const rawBody = JSON.stringify(REAL_ZOHO_PAYLOAD);
    const now = Math.floor(Date.now() / 1000);

    // 1. Dynamic HMAC-SHA256 Strategy
    const hmacSig = signWebhookPayload(secret, now, rawBody);
    const hmacKeyHeader = `t=${now},v1=${hmacSig}`;
    const hmacRes = await verifyWebhookSignature({
      headers: { "x-webhook-key": hmacKeyHeader },
      rawBody,
      tenant: mockTenant as any,
      query: {},
      bodyObj: REAL_ZOHO_PAYLOAD,
      nonceRepo: { findOne: async () => null, create: async () => {} }
    });
    expect(hmacRes.success).toBe(true);

    // 2. Static Secret Header Strategy
    const staticRes = await verifyWebhookSignature({
      headers: { "x-webhook-secret": secret },
      rawBody,
      tenant: mockTenant as any,
      query: {},
      bodyObj: REAL_ZOHO_PAYLOAD
    });
    expect(staticRes.success).toBe(true);

    // 3. Bearer Token Strategy
    const bearerRes = await verifyWebhookSignature({
      headers: { authorization: `Bearer ${secret}` },
      rawBody,
      tenant: mockTenant as any,
      query: {},
      bodyObj: REAL_ZOHO_PAYLOAD
    });
    expect(bearerRes.success).toBe(true);

    // 4. Query Parameter Strategy
    const queryRes = await verifyWebhookSignature({
      headers: {},
      rawBody,
      tenant: mockTenant as any,
      query: { secret },
      bodyObj: REAL_ZOHO_PAYLOAD
    });
    expect(queryRes.success).toBe(true);

    // 5. Body Secret Strategy
    const bodyObjWithSecret = { ...REAL_ZOHO_PAYLOAD, secret };
    const bodyRes = await verifyWebhookSignature({
      headers: {},
      rawBody: JSON.stringify(bodyObjWithSecret),
      tenant: mockTenant as any,
      query: {},
      bodyObj: bodyObjWithSecret
    });
    expect(bodyRes.success).toBe(true);

    // 6. Rejected Bad Secret
    const badRes = await verifyWebhookSignature({
      headers: { "x-webhook-secret": "invalid_secret" }, // gitleaks:allow
      rawBody,
      tenant: mockTenant as any,
      query: {},
      bodyObj: REAL_ZOHO_PAYLOAD
    });
    expect(badRes.success).toBe(false);
    if (!badRes.success) {
      expect(badRes.status).toBe(401);
    }
  });

  test("Scenario 3: Mathematical Reconciliation & Self-Healing of Damaged Real Payload", () => {
    const corruptedData = {
      id: "DDL-INV-860",
      invoice_line: [
        {
          invoiced_quantity: 2,
          price: { price_amount: 50 },
          line_extension_amount: 0 // damaged math
        }
      ],
      tax_total: [{ tax_amount: 7.5 }],
      legal_monetary_total: {
        line_extension_amount: 0, // damaged
        tax_exclusive_amount: 0,
        tax_inclusive_amount: 0,
        payable_amount: 0
      }
    };

    const reconcile = DeterministicCompleter.reconcileAndComplete(
      corruptedData,
      authContext,
      firsSchema,
      []
    );

    const healed = reconcile.completedData;
    expect(healed.invoice_line[0].line_extension_amount).toBe(100);
    expect(healed.legal_monetary_total.line_extension_amount).toBe(100);
    expect(healed.legal_monetary_total.tax_exclusive_amount).toBe(100);
    expect(healed.legal_monetary_total.tax_inclusive_amount).toBe(107.5);
    expect(healed.legal_monetary_total.payable_amount).toBe(107.5);
  });

  test("Scenario 4: Deep Non-Destructive Merge (LLM partial output cannot overwrite mapped data)", () => {
    const transformer = new FIRSInvoiceTransformerV2("fake_key");
    const baselineMapped = {
      id: "DDL-INV-860",
      accounting_customer_party: {
        party_name: "Test Company",
        party_tax_scheme: { company_id: "00364075-0001" }
      },
      invoice_line: [
        {
          item: { name: "Access Point" },
          invoiced_quantity: 1,
          line_extension_amount: 1.00
        }
      ],
      legal_monetary_total: { payable_amount: 1.08 }
    };

    const incompleteLlmOutput = {
      accounting_customer_party: { party_name: "" }, // tries to overwrite with empty string
      invoice_line: [], // tries to strip invoice lines
      note: "Added LLM note" // new field
    };

    const merged = (transformer as any).deepMergePreserveExisting(baselineMapped, incompleteLlmOutput);

    expect(merged.id).toBe("DDL-INV-860");
    expect(merged.accounting_customer_party.party_name).toBe("Test Company");
    expect(merged.accounting_customer_party.party_tax_scheme.company_id).toBe("00364075-0001");
    expect(merged.invoice_line.length).toBe(1);
    expect(merged.invoice_line[0].item.name).toBe("Access Point");
    expect(merged.legal_monetary_total.payable_amount).toBe(1.08);
    expect(merged.note).toBe("Added LLM note");
  });

  test("Scenario 5: Circuit Breaker Failure Recovery on 429 LLM Rate Limit", async () => {
    const circuitBreaker = TransformerCircuitBreaker.getInstance();
    circuitBreaker.reset();

    const rateLimitError = new Error("429 Too Many Requests: Rate limit reached");
    circuitBreaker.recordFailure(rateLimitError);

    expect(circuitBreaker.getState()).toBe("OPEN");
    expect(circuitBreaker.canExecute()).toBe(false);

    // Call transformer when circuit breaker is open
    const transformer = new FIRSInvoiceTransformerV2("fake_key");
    const result = await transformer.transformInvoice(
      REAL_ZOHO_PAYLOAD,
      authContext,
      [],
      firsSchema,
      zohoMappingRules,
      FIRSInvoiceSchema
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as any).id).toBe("DDL-INV-860");
    }
  });

  test("Scenario 6: Ingestion of Zoho XML Payload", () => {
    const xmlPayload = `<?xml version="1.0" encoding="UTF-8"?>
    <invoice>
      <invoice_number>DDL-INV-860</invoice_number>
      <customer_name>Test Company</customer_name>
      <cf_tin>00364075-0001</cf_tin>
      <total>1.08</total>
      <sub_total>1.00</sub_total>
      <currency_code>NGN</currency_code>
    </invoice>`;

    expect(isXmlPayload(xmlPayload)).toBe(true);
    const parsed = parseXmlToJson(xmlPayload);
    expect(parsed.invoice.invoice_number).toBe("DDL-INV-860");
    expect(parsed.invoice.customer_name).toBe("Test Company");
    expect(parsed.invoice.cf_tin).toBe("00364075-0001");
  });
});
