import { BadRequestError } from "../../../@lib/errors";
import { AuthContext } from "../../../middlewares";

export interface SecureInvoice {
  tenant_id?: string;
  tenantId?: string;
  business_id?: string;
  businessId?: string;
  supplier_tin?: string;
  supplierTin?: string;
  agent_tin?: string;
  agentTin?: string;
  [key: string]: unknown;
}

/**
 * Validates and force-overwrites tenant/business/TIN identifiers in the invoice payload
 * using securely authenticated request context variables to prevent tenant spoofing.
 * 
 * @throws {BadRequestError} if there is a mismatch between client-supplied tenant ID and authenticated tenant ID
 */
export function secureAndValidateInvoice(invoice: SecureInvoice, auth?: AuthContext): SecureInvoice {
  // 4.2 Security check: Validate client-supplied tenant_id if present
  const bodyTenantId = invoice.tenant_id || invoice.tenantId;
  if (bodyTenantId && auth && auth.tenantId && bodyTenantId !== auth.tenantId) {
    throw new BadRequestError('Tenant ID mismatch');
  }

  // Force-overwrite with authenticated context variables to prevent tenant spoofing
  if (auth) {
    if (auth.tenantId) {
      invoice.tenant_id = auth.tenantId;
      invoice.tenantId = auth.tenantId;
    }
    if (auth.businessId) {
      invoice.business_id = auth.businessId;
      invoice.businessId = auth.businessId;
    }
    if (auth.businessTIN) {
      invoice.supplier_tin = auth.businessTIN;
      invoice.supplierTin = auth.businessTIN;
      invoice.agent_tin = auth.businessTIN;
      invoice.agentTin = auth.businessTIN;
    }
  }

  return invoice;
}
