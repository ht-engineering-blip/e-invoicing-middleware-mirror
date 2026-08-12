// Encryption utilities

import { randomBytes } from "crypto";

export const hashString = async (str: string): Promise<string> => {
  return await Bun.password.hash(str, {
    algorithm: "bcrypt",
  });
};

export const verifyHash = async (
  str: string,
  hash: string,
): Promise<boolean> => {
  return await Bun.password.verify(str, hash, 'bcrypt');
};

export const generateRandomString = (length: number = 32): string => {
  return randomBytes(length).toString("hex");
};
