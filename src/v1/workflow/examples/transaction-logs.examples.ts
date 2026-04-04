import { faker } from '@faker-js/faker';

const transactionRef = `TRF-${faker.date.recent().toISOString().split('T')[0].replace(/-/g, '')}-${faker.string.alphanumeric(6).toUpperCase()}`;
const paymentAmount = faker.number.float({ min: 10000, max: 500000, fractionDigits: 2 });

export const updatePaymentStatusExample = {
  paymentStatus: 'PAID',
  paymentDetails: {
    paymentDate: faker.date.recent({ days: 5 }).toISOString().split('T')[0],
    paymentMethod: 'bank_transfer',
    transactionReference: transactionRef,
    amountPaid: paymentAmount,
  },
};

export const retryFromStepExample = {
  fromStep: 'validate',
};
