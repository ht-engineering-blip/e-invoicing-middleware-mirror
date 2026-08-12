
/**
 * Invoice Payment Status
 */
enum InvoicePaymentStatus {
    PENDING = 'PENDING',
    PAID = 'PAID',
    REJECTED = 'REJECTED',
}

/**
 * Generate IRN Input
 */
interface GenerateIRNInput {
    businessId: string;
    invoiceNumber: string;
    issueDate?: Date;
}