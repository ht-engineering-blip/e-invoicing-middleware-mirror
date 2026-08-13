import crypto from "crypto";

export function encryptSensitiveData(data: string, key?: any): string {
  const algorithm = "aes-256-gcm";
  key = crypto.scryptSync(key || process.env.ENCRYPTION_KEY, "salt", 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, key, iv, {
    authTagLength: 16,
  });

  let encrypted = cipher.update(data, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  // Return: iv + authTag + encrypted data
  return iv.toString("hex") + ":" + authTag.toString("hex") + ":" + encrypted;
}

export function decryptSensitiveData(encryptedData: string, key?: any): string {
  const algorithm = "aes-256-gcm";
  key = crypto.scryptSync(key || process.env.ENCRYPTION_KEY, "salt", 32);

  const parts = encryptedData.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted data format");
  }

  const iv = Buffer.from(parts[0], "hex");
  const authTag = Buffer.from(parts[1], "hex");
  const encrypted = parts[2];

  const decipher = crypto.createDecipheriv(algorithm, key, iv, {
    authTagLength: 16,
  });
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

/**
 * Input interface for the encryption function
 */
interface CryptoKeys {
  public_key: string; // Base64-encoded public key
  certificate: string; // Base64-encoded certificate
}

/**
 * Input interface for the encryption payload
 */
interface EncryptionPayload {
  irn: string; // Invoice Reference Number
  certificate: string; // Base64-encoded certificate
}

/**
 * Result interface for the encryption operation
 */
interface EncryptionResult {
  encryptedData: string; // Base64-encoded encrypted data
  timestamp: number; // UNIX timestamp used in encryption
}

/**
 * Extracts and decodes the public key from base64-encoded string
 *
 * @param base64PublicKey - Base64-encoded public key
 * @returns Decoded public key in PEM format
 */
export function extractPublicKey(base64PublicKey: string): string {
  // Decode the base64-encoded public key
  const decodedKey = Buffer.from(base64PublicKey, "base64").toString("utf-8");

  // The decoded key should already be in PEM format
  // If it's not properly formatted, we might need to add headers
  if (!decodedKey.includes("-----BEGIN PUBLIC KEY-----")) {
    return `-----BEGIN PUBLIC KEY-----\n${decodedKey}\n-----END PUBLIC KEY-----`;
  }

  return decodedKey;
}

/**
 * Generates a UNIX timestamp
 *
 * @returns Current UNIX timestamp in seconds
 */
function generateTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Prepares the IRN with timestamp in the required format
 *
 * @param irn - Invoice Reference Number
 * @param timestamp - UNIX timestamp (optional, will be generated if not provided)
 * @returns IRN with appended timestamp (e.g., "INV001-345SFG-20241011.1731618237")
 */
function prepareIRNWithTimestamp(irn: string, timestamp?: number): string {
  const ts = timestamp || generateTimestamp();
  return `${irn}.${ts}`;
}

/**
 * Encrypts the IRN and certificate using RSA public key encryption
 *
 * @param cryptoKeys - Object containing base64-encoded public_key
 * @param irn - Invoice Reference Number
 * @param certificate - Base64-encoded certificate
 * @param timestamp - Optional UNIX timestamp (will be generated if not provided)
 * @returns Encrypted data as base64 string along with the timestamp used
 *
 * @example
 * ```typescript
 * const keys = {
 *   public_key: "LS0tLS1CRUdJTiBQVUJMSUMgS0VZLS0tLS0...",
 *   certificate: "VVhrallFNVZUdDV0eUJmYWV1RmYwUXJRNEhTdXlhcU1pOGZsWF35sfhWRT0="
 * };
 *
 * const result = encryptIRNAndCertificate(
 *   keys,
 *   "INV001-345SFG-20241011",
 *   keys.certificate
 * );
 *
 * console.log(result.encryptedData); // Base64-encoded encrypted data
 * console.log(result.timestamp); // Timestamp used in encryption
 * ```
 */
export function encryptIRNAndCertificate(
  cryptoKeys: CryptoKeys,
  irn: string,
  certificate: string,
  timestamp?: number,
): EncryptionResult {
  try {
    // Step 1: Extract and decode the public key
    const publicKeyPEM = extractPublicKey(cryptoKeys.public_key);
    console.log(publicKeyPEM);
    // Step 2: Generate timestamp and prepare IRN
    const ts = timestamp || generateTimestamp();
    const irnWithTimestamp = prepareIRNWithTimestamp(irn, ts);

    // Step 3: Create the payload object
    const payload: EncryptionPayload = {
      irn: irnWithTimestamp,
      certificate: certificate,
    };

    // Step 4: Convert payload to JSON string
    const payloadString = JSON.stringify(payload);

    console.log(payloadString);

    // Step 5: Encrypt the payload using the public key
    // Using RSA-OAEP padding (recommended for security)
    const encryptedBuffer = crypto.publicEncrypt(
      {
        key: publicKeyPEM,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      Buffer.from(payloadString, "utf-8"),
    );

    // Step 6: Convert encrypted data to base64
    const encryptedBase64 = encryptedBuffer.toString("base64");

    return {
      encryptedData: encryptedBase64,
      timestamp: ts,
    };
  } catch (error) {
    throw new Error(
      `Encryption failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * Alternative encryption function using PKCS1 padding
 * (Use this if the server expects PKCS1 padding instead of OAEP)
 *
 * @param cryptoKeys - Object containing base64-encoded public_key
 * @param irn - Invoice Reference Number
 * @param certificate - Base64-encoded certificate
 * @param timestamp - Optional UNIX timestamp
 * @returns Encrypted data as base64 string along with the timestamp used
 */
export function encryptIRNAndCertificatePKCS1(
  cryptoKeys: CryptoKeys,
  irn: string,
  certificate: string,
  timestamp?: number,
): EncryptionResult {
  try {
    const publicKeyPEM = extractPublicKey(cryptoKeys.public_key);
    const ts = timestamp || generateTimestamp();
    const irnWithTimestamp = prepareIRNWithTimestamp(irn, ts);

    const payload: EncryptionPayload = {
      irn: irnWithTimestamp,
      certificate: certificate,
    };

    const payloadString = JSON.stringify(payload);

    // Using RSA PKCS1 padding (matches openssl pkeyutl default behavior)
    const encryptedBuffer = crypto.publicEncrypt(
      {
        key: publicKeyPEM,
        padding: crypto.constants.RSA_PKCS1_PADDING,
      },
      Buffer.from(payloadString, "utf-8"),
    );

    const encryptedBase64 = encryptedBuffer.toString("base64");

    return {
      encryptedData: encryptedBase64,
      timestamp: ts,
    };
  } catch (error) {
    throw new Error(
      `Encryption failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * Utility function to decrypt data (for testing purposes)
 * Note: This requires the private key which should be kept secure
 *
 * @param encryptedBase64 - Base64-encoded encrypted data
 * @param privateKeyPEM - Private key in PEM format
 * @returns Decrypted payload object
 */
export function decryptData(
  encryptedBase64: string,
  privateKeyPEM: string,
): EncryptionPayload {
  try {
    const encryptedBuffer = Buffer.from(encryptedBase64, "base64");

    const decryptedBuffer = crypto.privateDecrypt(
      {
        key: privateKeyPEM,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      encryptedBuffer,
    );

    const decryptedString = decryptedBuffer.toString("utf-8");
    return JSON.parse(decryptedString);
  } catch (error) {
    throw new Error(
      `Decryption failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

export type { CryptoKeys, EncryptionPayload, EncryptionResult };
