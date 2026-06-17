import { describe, it, expect, mock, beforeAll, afterAll } from 'bun:test';
import { FIRSInvoiceSchema, FIRSInvoiceTransformer } from '../src/v1/workflow/utils/transformer';
import { AuthContext } from '../src/middlewares';

const definitions: Record<string, Function> = {};
mock.module('../src/@lib/queue/agenda', () => {
  return {
    agenda: {
      define: (name: string, fn: Function) => {
        definitions[name] = fn;
      }
    }
  };
});

let lastNextOutput: any = null;
let lastFailError: any = null;
mock.module('../src/v1/workflow/jobs/chain', () => {
  return {
    chainNext: async (job: any, stepOutput: any) => {
      lastNextOutput = stepOutput;
      return Promise.resolve();
    },
    chainFail: async (job: any, error: any) => {
      lastFailError = error;
      return Promise.resolve();
    }
  };
});

const mockFindOne = mock(() => Promise.resolve(null));
const mockFindByIrn = mock(() => Promise.resolve(null));
const mockUpdate = mock(() => Promise.resolve({}));
const mockUpdateWorkflowState = mock(() => Promise.resolve({}));

mock.module('../src/v1/workflow/repos/outbound-invoice.repo', () => {
  return {
    OutboundInvoiceRepository: class {
      findOne = mockFindOne;
      findByIrn = mockFindByIrn;
      update = mockUpdate;
      updateWorkflowState = mockUpdateWorkflowState;
    }
  };
});

// Mock the database repos so we don't connect to mongo
mock.module('../src/v1/workflow/services/workflows/transform.service', () => {
  return {
    TransformWorkflowService: class {
      async getInvoiceSchema() {
        return { fields: [], mapping_rules: [] };
      }
    }
  };
});

describe('FIRS Credit Note Invoicing and Validation', () => {
  const validSupplier = {
    party_name: 'Okeke Technologies Ltd',
    tin: '12345678-0001',
    email: 'billing@okeketech.ng',
    telephone: '+234 802 123 4567',
    business_description: 'Technology Services',
    postal_address: {
      street_name: '12 Marina Road',
      city_name: 'Lagos',
      postal_zone: '100001',
      country: 'NG'
    }
  };

  const validCustomer = {
    party_name: 'Zenith Corp',
    tin: '98765432-0001',
    email: 'accounts@zenithcorp.ng',
    telephone: '+234 701 987 6543',
    business_description: 'Manufacturing',
    postal_address: {
      street_name: '45 Industrial Avenue',
      city_name: 'Ikeja',
      postal_zone: '100213',
      country: 'NG'
    }
  };

  const validLineItems = [
    {
      hsn_code: '8471.30',
      product_category: 'Laptop Computers',
      invoiced_quantity: 2,
      line_extension_amount: 600000.00,
      item: {
        name: 'Laptop Computer - Model X',
        description: '2 units returned - defective screens',
        sellers_item_identification: '8471.30'
      },
      price: {
        price_amount: 300000.00,
        base_quantity: 1,
        price_unit: 'NGN 300,000.00 per Each'
      }
    }
  ];

  const validTaxTotal = [
    {
      tax_amount: 45000.00,
      tax_subtotal: [
        {
          taxable_amount: 600000.00,
          tax_amount: 45000.00,
          tax_category: {
            id: 'STANDARD_VAT',
            percent: 7.50
          }
        }
      ]
    }
  ];

  const validMonetaryTotal = {
    line_extension_amount: 600000.00,
    tax_exclusive_amount: 600000.00,
    tax_inclusive_amount: 645000.00,
    payable_amount: 645000.00
  };

  const baseInvoicePayload = {
    business_id: '1c6eaf77-d0bd-455c-9c5c-500a3f1dbfb2',
    irn: 'INV0042-6AFCD0BD-20260401',
    issue_date: '2026-04-11',
    due_date: '2026-04-11',
    issue_time: '10:30:00',
    invoice_type_code: '396', // standard invoice request
    payment_status: 'UNPAID',
    tax_point_date: '2026-04-11',
    document_currency_code: 'NGN',
    tax_currency_code: 'NGN',
    accounting_supplier_party: validSupplier,
    accounting_customer_party: validCustomer,
    invoice_line: validLineItems,
    tax_total: validTaxTotal,
    legal_monetary_total: validMonetaryTotal
  };

  describe('Zod Schema Validation', () => {
    it('should successfully validate a standard invoice without billing_reference', () => {
      const result = FIRSInvoiceSchema.safeParse(baseInvoicePayload);
      expect(result.success).toBe(true);
    });

    it('should fail to validate a credit note (381) without billing_reference', () => {
      const creditNotePayload = {
        ...baseInvoicePayload,
        invoice_type_code: '381',
      };
      const result = FIRSInvoiceSchema.safeParse(creditNotePayload);
      expect(result.success).toBe(false);
      if (!result.success) {
        const errors = result.error.flatten();
        expect(errors.fieldErrors.billing_reference).toBeDefined();
        expect(errors.fieldErrors.billing_reference?.[0]).toContain('billing_reference is required');
      }
    });

    it('should fail to validate a credit note (381) with an empty billing_reference array', () => {
      const creditNotePayload = {
        ...baseInvoicePayload,
        invoice_type_code: '381',
        billing_reference: []
      };
      const result = FIRSInvoiceSchema.safeParse(creditNotePayload);
      expect(result.success).toBe(false);
      if (!result.success) {
        const errors = result.error.flatten();
        expect(errors.fieldErrors.billing_reference).toBeDefined();
      }
    });

    it('should successfully validate a credit note (381) with a valid billing_reference', () => {
      const creditNotePayload = {
        ...baseInvoicePayload,
        invoice_type_code: '381',
        billing_reference: [
          {
            irn: 'INV0042-6AFCD0BD-20260401',
            issue_date: '2026-04-01'
          }
        ]
      };
      const result = FIRSInvoiceSchema.safeParse(creditNotePayload);
      expect(result.success).toBe(true);
    });

    it('should validate hsn_code and format it with a decimal if it does not have one (e.g., 90983 -> 90983.00)', () => {
      const payload = {
        ...baseInvoicePayload,
        invoice_line: [
          {
            ...validLineItems[0],
            hsn_code: '90983',
          }
        ]
      };
      const result = FIRSInvoiceSchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.invoice_line[0].hsn_code).toBe('90983.00');
      }
    });

    it('should preserve hsn_code if it already has a decimal (e.g., 8471.30)', () => {
      const payload = {
        ...baseInvoicePayload,
        invoice_line: [
          {
            ...validLineItems[0],
            hsn_code: '8471.30',
          }
        ]
      };
      const result = FIRSInvoiceSchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.invoice_line[0].hsn_code).toBe('8471.30');
      }
    });

    it('should successfully validate an empty/missing hsn_code', () => {
      const payload = {
        ...baseInvoicePayload,
        invoice_line: [
          {
            ...validLineItems[0],
            hsn_code: '',
          }
        ]
      };
      const result = FIRSInvoiceSchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.invoice_line[0].hsn_code).toBe('');
      }
    });

    it('should successfully validate a non-numeric/custom hsn_code and preserve it without appending decimal', () => {
      const payload = {
        ...baseInvoicePayload,
        invoice_line: [
          {
            ...validLineItems[0],
            hsn_code: 'CC-001',
          }
        ]
      };
      const result = FIRSInvoiceSchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.invoice_line[0].hsn_code).toBe('CC-001');
      }
    });
  });

  describe('FIRSInvoiceTransformer LLM Integration & Auto-Fix', () => {
    let originalFetch: typeof global.fetch;

    beforeAll(() => {
      originalFetch = global.fetch;
    });

    afterAll(() => {
      global.fetch = originalFetch;
    });

    it('should transform and preserve credit note fields and billing_reference', async () => {
      const transformer = new FIRSInvoiceTransformer('mock-api-key');

      const mockTransformedPayload = {
        business_id: '1c6eaf77-d0bd-455c-9c5c-500a3f1dbfb2',
        irn: 'CN0001-6AFCD0BD-20260411',
        issue_date: '2026-04-11',
        due_date: '2026-04-11',
        issue_time: '10:30:00',
        invoice_type_code: '381',
        payment_status: 'UNPAID',
        tax_point_date: '2026-04-11',
        document_currency_code: 'NGN',
        tax_currency_code: 'NGN',
        billing_reference: [
          {
            irn: 'INV0042-6AFCD0BD-20260401',
            issue_date: '2026-04-01'
          }
        ],
        accounting_supplier_party: validSupplier,
        accounting_customer_party: validCustomer,
        invoice_line: validLineItems,
        tax_total: validTaxTotal,
        legal_monetary_total: validMonetaryTotal
      };

      // Mock LLM fetch response
      global.fetch = mock(() => {
        return Promise.resolve(new Response(JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify(mockTransformedPayload)
              }
            }
          ]
        }), { status: 200 }));
      }) as any;

      const authContext: AuthContext = {
        tenantId: 'tenant-123',
        businessId: '1c6eaf77-d0bd-455c-9c5c-500a3f1dbfb2',
        businessName: 'Okeke Technologies Ltd',
        businessTIN: '12345678-0001',
        serviceId: '6AFCD0BD',
        isAdmin: false,
        scopes: ['*']
      };

      const result = await transformer.transformAndValidate(
        {
          irn: 'CN0001-6AFCD0BD-20260411',
          invoice_type_code: '381',
          billing_reference: [
            {
              irn: 'INV0042-6AFCD0BD-20260401',
              issue_date: '2026-04-01'
            }
          ]
        },
        authContext
      );

      expect(result).toBeDefined();
      expect(result?.success).toBe(true);
      expect(result?.data.invoice_type_code).toBe('381');
      expect(result?.data.billing_reference).toBeDefined();
      expect(result?.data.billing_reference[0].irn).toBe('INV0042-6AFCD0BD-20260401');
    });
  });

  describe('process_credit_note Agenda Job', () => {
    it('should process a credit note job by cloning the original invoice and setting credit note fields', async () => {
      const { registerProcessCreditNoteJob } = await import('../src/v1/workflow/jobs/definitions/process-credit-note.job');
      registerProcessCreditNoteJob();

      const jobFn = definitions['workflow:process-credit-note'];
      expect(jobFn).toBeDefined();

      const mockOriginalInvoice = {
        irn: 'INV0042-6AFCD0BD-20260401',
        createdAt: new Date('2026-04-01T10:00:00Z'),
        metadata: {
          transformedInvoice: {
            business_id: '1c6eaf77-d0bd-455c-9c5c-500a3f1dbfb2',
            irn: 'INV0042-6AFCD0BD-20260401',
            issue_date: '2026-04-01',
            invoice_type_code: '396',
            document_currency_code: 'NGN',
            accounting_supplier_party: validSupplier,
            accounting_customer_party: validCustomer,
            invoice_line: validLineItems,
            tax_total: validTaxTotal,
            legal_monetary_total: validMonetaryTotal
          }
        }
      };

      mockFindOne.mockImplementation(() => Promise.resolve(mockOriginalInvoice as any));

      const mockJob: any = {
        attrs: {
          data: {
            tenantId: 'tenant-123',
            authContext: {
              tenantId: 'tenant-123',
              businessId: '1c6eaf77-d0bd-455c-9c5c-500a3f1dbfb2',
              businessTIN: '12345678-0001',
              serviceId: '6AFCD0BD',
              tenantERP: 'SAP'
            },
            context: {
              originalPayload: {
                referenceId: 'INV0042-6AFCD0BD-20260401',
                creditNoteId: 'CN-9999'
              },
              irn: 'CN0001-6AFCD0BD-20260411',
              erpInvoiceId: 'CN-9999'
            },
            jobChainId: 'job-chain-456'
          }
        }
      };

      lastNextOutput = null;
      lastFailError = null;

      await jobFn(mockJob);

      expect(lastFailError).toBeNull();
      expect(lastNextOutput).toBeDefined();
      expect(lastNextOutput.transformedInvoice).toBeDefined();
      expect(lastNextOutput.transformedInvoice.invoice_type_code).toBe('381');
      expect(lastNextOutput.transformedInvoice.billing_reference).toBeDefined();
      expect(lastNextOutput.transformedInvoice.billing_reference[0].irn).toBe('INV0042-6AFCD0BD-20260401');
      expect(lastNextOutput.transformedInvoice.irn).toBe('CN0001-6AFCD0BD-20260411');
      expect(lastNextOutput.transformedInvoice.invoice_reference).toBe('CN-9999');

      // Verify DB updates were called
      expect(mockUpdate).toHaveBeenCalled();
      expect(mockUpdateWorkflowState).toHaveBeenCalled();
    });
  });
});
