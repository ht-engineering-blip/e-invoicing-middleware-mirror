// Encryption utilities

import { createHash, randomBytes } from "crypto";

export const hashString = async (str: string): Promise<string> => {
  return await Bun.password.hash(str, {
    algorithm: "bcrypt",
  });
};

export const generateRandomString = (length: number = 32): string => {
  return randomBytes(length).toString("hex");
};
