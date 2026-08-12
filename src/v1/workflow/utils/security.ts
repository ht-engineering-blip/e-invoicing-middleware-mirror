import { BadRequestError } from "../../../@lib/errors";
import { AuthContext } from "../../../middlewares";

/**
 * Force-overwrites tenant and business identifiers in the invoice payload
 * using securely authenticated request context variables to prevent tenant spoofing.
 */
export function secureAndValidateInvoice(
  invoice: SecureInvoice,
  auth?: AuthContext,
): SecureInvoice {
  if (!auth || !auth.tenantId || !auth.businessId) {
    throw new BadRequestError(
      "Authenticated tenant context is missing required identifiers",
    );
  }

  // Force-overwrite with authenticated context variables to prevent tenant spoofing
  invoice.tenant_id = auth.tenantId;
  invoice.business_id = auth.businessId;

  return invoice;
}
