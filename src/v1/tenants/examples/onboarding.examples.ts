export const updateCredentialsExample = {
  publicKey: `-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA2a/example/public/key\n-----END PUBLIC KEY-----`,
  certificate: `-----BEGIN CERTIFICATE-----\nMIIDXTCCAkWgAwIBAgIJAexample/certificate\n-----END CERTIFICATE-----`,
};

export const generateWebhookExample = {
  invoiceIdKey: 'invoice.documentId',
};

export const updateInvoiceIdKeyExample = {
  invoiceIdKey: 'invoice.documentId',
};

export const testWebhookExample = {
  testPayload: {
    event: 'webhook.test',
    data: {
      message: 'Test webhook from E-Invoicing Platform',
      timestamp: new Date().toISOString(),
    },
  },
};
