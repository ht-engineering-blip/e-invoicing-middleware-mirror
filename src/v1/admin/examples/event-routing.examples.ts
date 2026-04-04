import { faker } from '@faker-js/faker';

export const addRouteExample = {
  event: 'erp.invoice.submitted',
  actions: ['generate_irn', 'transform', 'validate', 'sign', 'transmit', 'sync_erp'],
  enabled: true,
  description: 'Full outbound pipeline triggered on ERP invoice submission',
};

export const updateRouteExample = {
  actions: ['generate_irn', 'transform', 'validate', 'sign', 'transmit'],
  enabled: true,
  description: 'Updated action sequence',
};

export const replaceRoutesExample = {
  routes: [
    {
      event: 'erp.invoice.submitted',
      actions: ['generate_irn', 'transform', 'validate', 'sign', 'transmit', 'sync_erp'],
      enabled: true,
      description: 'Full outbound pipeline',
    },
    {
      event: 'invoice.received',
      actions: ['complete_inbound'],
      enabled: true,
      description: 'Inbound invoice acknowledgement',
    },
    {
      event: 'invoice.paid',
      actions: ['update_payment_status'],
      enabled: true,
      description: 'VAT post-payment report to FIRS',
    },
  ],
};
