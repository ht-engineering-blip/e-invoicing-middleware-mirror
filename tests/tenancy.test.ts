import { describe, it, expect, mock } from 'bun:test';
import { ModelWrapper } from '../src/@lib/adapters/mongo/model-wrapper';
import { BadRequestError } from '../src/@lib/errors';
import { secureAndValidateInvoice } from '../src/v1/workflow/utils/security';

// A mock Mongoose Model to verify arguments passed by ModelWrapper
const createMockModel = () => {
  return {
    find: mock((query: any, ...args: any[]) => ({ exec: async () => [query, ...args] })),
    countDocuments: mock((query: any, ...args: any[]) => ({ exec: async () => 42 })),
    findOne: mock((query: any, ...args: any[]) => ({ exec: async () => query })),
    findById: mock((id: any, ...args: any[]) => ({ exec: async () => id })),
    findByIdAndUpdate: mock((id: any, update: any, ...args: any[]) => ({ exec: async () => ({ id, update }) })),
    findByIdAndDelete: mock((id: any, ...args: any[]) => ({ exec: async () => id })),
    updateOne: mock((query: any, update: any, ...args: any[]) => ({ exec: async () => ({ query, update }) })),
    deleteOne: mock((query: any, ...args: any[]) => ({ exec: async () => query })),
    create: mock((docOrDocs: any) => Promise.resolve(docOrDocs)),
    findOneAndUpdate: mock((query: any, update: any, ...args: any[]) => ({ exec: async () => ({ query, update }) })),
    aggregate: mock((pipeline: any[]) => Promise.resolve(pipeline)),
    updateMany: mock((query: any, update: any, ...args: any[]) => ({ exec: async () => ({ query, update }) })),
    deleteMany: mock((query: any, ...args: any[]) => ({ exec: async () => query })),
  } as any;
};

describe('ModelWrapper Tenancy & Bug Fixes', () => {
  it('should proxy find calls without injecting businessId', async () => {
    const mockModel = createMockModel();
    const wrapper = new ModelWrapper(mockModel);

    const query = { name: 'test-invoice' };
    const result = await wrapper.find(query).exec();

    // The query passed to mockModel.find should exactly match the passed query (no businessId injected)
    expect(mockModel.find).toHaveBeenCalled();
    expect(mockModel.find.mock.calls[0][0]).toEqual(query);
    expect(mockModel.find.mock.calls[0][0].businessId).toBeUndefined();
  });

  it('should proxy countDocuments calls without injecting businessId', async () => {
    const mockModel = createMockModel();
    const wrapper = new ModelWrapper(mockModel);

    const query = { status: 'PAID' };
    await wrapper.countDocuments(query).exec();

    expect(mockModel.countDocuments).toHaveBeenCalled();
    expect(mockModel.countDocuments.mock.calls[0][0]).toEqual(query);
    expect(mockModel.countDocuments.mock.calls[0][0].businessId).toBeUndefined();
  });

  it('should pass correct arguments to findById (bug fix)', async () => {
    const mockModel = createMockModel();
    const wrapper = new ModelWrapper(mockModel);

    const testId = '507f1f77bcf86cd799439011';
    const result = await wrapper.findById(testId).exec();

    // ModelWrapper.findById should now call model.findById(id) directly
    expect(mockModel.findById).toHaveBeenCalled();
    expect(mockModel.findById.mock.calls[0][0]).toBe(testId);
  });

  it('should pass correct arguments to findByIdAndUpdate (bug fix)', async () => {
    const mockModel = createMockModel();
    const wrapper = new ModelWrapper(mockModel);

    const testId = '507f1f77bcf86cd799439011';
    const update = { $set: { status: 'PAID' } };
    await wrapper.findByIdAndUpdate(testId, update).exec();

    // ModelWrapper.findByIdAndUpdate should now call model.findByIdAndUpdate(id, update)
    expect(mockModel.findByIdAndUpdate).toHaveBeenCalled();
    expect(mockModel.findByIdAndUpdate.mock.calls[0][0]).toBe(testId);
    expect(mockModel.findByIdAndUpdate.mock.calls[0][1]).toBe(update);
  });

  it('should proxy create calls without modifying inputs with businessId', async () => {
    const mockModel = createMockModel();
    const wrapper = new ModelWrapper(mockModel);

    const doc = { invoiceNumber: 'INV-001', customerName: 'Client A' };
    const result = await wrapper.create(doc);

    expect(mockModel.create).toHaveBeenCalled();
    expect(result).toEqual(doc);
    expect(result.businessId).toBeUndefined();
  });
});

describe('Workflow Endpoint Tenancy Enforcement', () => {
  const mockAuth = {
    tenantId: 'tenant-abc',
    businessId: 'business-xyz',
    businessTIN: '1234567890-0001',
    isAdmin: false,
  };

  const processInvoiceSecurely = secureAndValidateInvoice;

  it('should reject a request with mismatching tenant_id', () => {
    const maliciousInvoice = {
      tenant_id: 'tenant-victim',
      business_id: 'business-victim',
      irn: 'IRN-001',
    };

    expect(() => {
      processInvoiceSecurely(maliciousInvoice, mockAuth);
    }).toThrow(new BadRequestError('Tenant ID mismatch'));
  });

  it('should allow and force-overwrite fields for matching or unsupplied tenant_id', () => {
    const legitimateInvoice = {
      tenant_id: 'tenant-abc', // matches
      business_id: 'attacker-victim', // will be overwritten
      supplier_tin: 'old-tin', // will be overwritten
      accounting_supplier_party: {
        tin: 'old-tin-2',
        party_tax_scheme: {
          company_id: 'old-tin-3',
        },
      },
    };

    const securedInvoice = processInvoiceSecurely(legitimateInvoice, mockAuth);

    expect(securedInvoice.tenant_id).toBe(mockAuth.tenantId);
    expect(securedInvoice.tenantId).toBe(mockAuth.tenantId);
    expect(securedInvoice.business_id).toBe(mockAuth.businessId);
    expect(securedInvoice.businessId).toBe(mockAuth.businessId);
    expect(securedInvoice.supplier_tin).toBe(mockAuth.businessTIN);
    expect(securedInvoice.supplierTin).toBe(mockAuth.businessTIN);
    expect(securedInvoice.agent_tin).toBe(mockAuth.businessTIN);
    expect(securedInvoice.agentTin).toBe(mockAuth.businessTIN);
    expect(securedInvoice.accounting_supplier_party.tin).toBe(mockAuth.businessTIN);
    expect(securedInvoice.accounting_supplier_party.party_tax_scheme.company_id).toBe(mockAuth.businessTIN);
  });
});
