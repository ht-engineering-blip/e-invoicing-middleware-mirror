import { BadRequestError } from "../../../@lib/errors";
import { AuthContext } from "../../../middlewares";
import { safeJsonUnpack } from "./invoice-sanitizer.util";

/**
 * Force-overwrites tenant and business identifiers in the invoice payload
 * using securely authenticated request context variables to prevent tenant spoofing.
 */
export function secureAndValidateInvoice(
  rawInvoice: any,
  auth?: AuthContext,
): SecureInvoice {
  if (!auth || !auth.tenantId || !auth.businessId) {
    throw new BadRequestError(
      "Authenticated tenant context is missing required identifiers",
    );
  }

  const unpacked = safeJsonUnpack(rawInvoice) as any;
  const invoice =
    unpacked?.data && typeof unpacked.data === "object"
      ? unpacked.data
      : unpacked || {};

  // Cast securely as we populate the required fields below
  const secureInvoice = invoice as SecureInvoice;

  // Force-overwrite with authenticated context variables to prevent tenant spoofing
  secureInvoice.tenant_id = auth.tenantId;
  secureInvoice.business_id = auth.businessId;

  return secureInvoice;
}
