import { BadRequestError } from "../../../@lib/errors";
import { AuthContext } from "../../../middlewares";

/**
 * Force-overwrites tenant and business identifiers in the invoice payload
 * using securely authenticated request context variables to prevent tenant spoofing.
 */
export function secureAndValidateInvoice(
  invoice: Omit<SecureInvoice, "tenant_id" | "business_id"> & {
    tenant_id?: string;
    business_id?: string;
  },
  auth?: AuthContext,
): SecureInvoice {
  if (!auth || !auth.tenantId || !auth.businessId) {
    throw new BadRequestError(
      "Authenticated tenant context is missing required identifiers",
    );
  }

  // Cast securely as we populate the required fields below
  const secureInvoice = invoice as SecureInvoice;

  // Force-overwrite with authenticated context variables to prevent tenant spoofing
  secureInvoice.tenant_id = auth.tenantId;
  secureInvoice.business_id = auth.businessId;

  return secureInvoice;
}
