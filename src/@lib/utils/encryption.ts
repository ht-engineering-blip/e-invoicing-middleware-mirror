// Encryption utilities

import { createHash, randomBytes } from 'crypto';

export const hashString = (str: string): string => {
  return createHash('sha256').update(str).digest('hex');
};

export const generateRandomString = (length: number = 32): string => {
  return randomBytes(length).toString('hex');
};

