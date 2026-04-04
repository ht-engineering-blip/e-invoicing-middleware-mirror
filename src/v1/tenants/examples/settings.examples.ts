import { faker } from '@faker-js/faker';

export const updateBusinessInfoExample = {
  businessName: faker.company.name(),
  contactEmail: faker.internet.email(),
  contactPhone: `+234${faker.number.int({ min: 7000000000, max: 9099999999 })}`,
  address: {
    street: faker.location.streetAddress(),
    city: faker.location.city(),
    state: faker.location.state(),
    country: 'Nigeria',
    postalCode: faker.location.zipCode('######'),
  },
  website: faker.internet.url(),
  industry: faker.commerce.department(),
};
