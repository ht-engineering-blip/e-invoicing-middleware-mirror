/**
 * Unified FIRS Error Extractor
 * Extracts human-readable error messages and HTTP status codes from FIRS API responses
 * and axios error objects.
 */
export interface FIRSErrorDetails {
  message: string;
  code: number;
  errors: string[];
}

export function extractFIRSError(error: any): FIRSErrorDetails {
  const data =
    error?.response?.data ||
    error?.data ||
    error?.errors?.response ||
    error?.errors;

  const errorList: string[] = [];

  // Extract nested error list
  if (Array.isArray(data?.errors)) {
    for (const e of data.errors) {
      if (typeof e === "string") {
        errorList.push(e);
      } else if (e?.message) {
        errorList.push(e.message);
      } else {
        errorList.push(JSON.stringify(e));
      }
    }
  } else if (data?.errors) {
    errorList.push(
      typeof data.errors === "string"
        ? data.errors
        : JSON.stringify(data.errors),
    );
  }

  if (Array.isArray(error?.errors)) {
    for (const e of error.errors) {
      const msg = typeof e === "string" ? e : e?.message || JSON.stringify(e);
      if (!errorList.includes(msg)) {
        errorList.push(msg);
      }
    }
  }

  if (data?.error?.public_message) errorList.push(data.error.public_message);
  if (data?.error?.message && !errorList.includes(data.error.message)) {
    errorList.push(data.error.message);
  }
  if (data?.public_message && !errorList.includes(data.public_message)) {
    errorList.push(data.public_message);
  }
  if (data?.message && !errorList.includes(data.message)) {
    errorList.push(data.message);
  }

  const message =
    errorList[0] ||
    error?.message ||
    "An error occurred, please try again.";

  const code =
    error?.response?.status ||
    data?.code ||
    error?.statusCode ||
    error?.errors?.code ||
    500;

  return { message, code, errors: errorList };
}
