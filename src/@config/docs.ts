import { z } from "zod";

export interface DocsConfig {
  enabled: boolean;
  isProtected: boolean;
  username: string;
  password?: string;
}

const parseDocsConfig = (): DocsConfig => {
  const isProtected =
    process.env.DOCS_PROTECTED === "true" ||
    (typeof process.env.DOCS_PASSWORD === "string" &&
      process.env.DOCS_PASSWORD.trim() !== "");

  const enabled = process.env.DOCS_ENABLED !== "false";
  const username = process.env.DOCS_USERNAME?.trim() || "admin";
  const password = process.env.DOCS_PASSWORD?.trim() || undefined;

  return {
    enabled,
    isProtected,
    username,
    password,
  };
};

export const docsConfig = parseDocsConfig();
