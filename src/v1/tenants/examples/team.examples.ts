import { faker } from '@faker-js/faker';

export const acceptInviteExample = {
  password: `${faker.internet.password({ length: 10 })}#1A`,
};

export const inviteMemberExample = {
  email: faker.internet.email(),
  firstName: faker.person.firstName(),
  lastName: faker.person.lastName(),
  role: 'member',
  permissions: ['invoices:read', 'invoices:write'],
};

export const updateMemberExample = {
  firstName: faker.person.firstName(),
  lastName: faker.person.lastName(),
  role: 'viewer',
  permissions: ['invoices:read'],
  status: 'active',
};
