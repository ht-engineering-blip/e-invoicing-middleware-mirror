import crypto from "crypto";
import createDebug from "debug";
import QRCode from "qrcode";
import fetch from "node-fetch";
import { t } from "elysia";

const debug = createDebug("qr-generator");

function validatePEMFormat(pemString: string, type: string) {
  const pemPattern = /-----BEGIN [A-Z ]+-----[^-]*-----END [A-Z ]+-----/s;
  if (!pemPattern.test(pemString)) {
    debug(`Invalid ${type} PEM format`);
    return false;
  }
  return true;
}

function hexToRgb(hex: string) {
  hex = hex.replace("#", "");
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return { r, g, b, alpha: 1 };
}

export async function generateQRCode({
  irn,
  certificate,
  publicKey,
  size = 200,
  fgColor = "#000000",
  bgColor = "#FFFFFF",
  logo = null,
  logoSizeRatio = 0.2,
}: any) {
  debug("Generating QR code for IRN: %s", irn);

  function appendTimestamp(irn: string) {
    const now = new Date();
    const timePart =
      now.toTimeString().slice(0, 8).replace(/:/g, "") + now.getMilliseconds();
    return `${irn}.${timePart}`;
  }

  try {
    // Decode base64 public key to PEM format
    let pubKeyPemStr;
    try {
      pubKeyPemStr = Buffer.from(publicKey, "base64").toString("utf8");
      debug("Successfully decoded base64 public key");
    } catch (error) {
      pubKeyPemStr = publicKey;
      debug("Using public key as-is (not base64 encoded)");
    }

    if (!validatePEMFormat(pubKeyPemStr, "public key")) {
      throw new Error("Invalid public key format. Expected PEM format.");
    }

    // Prepare data with timestamp
    const irnWithTimestamp = appendTimestamp(irn);
    const jsonData = JSON.stringify({ irn: irnWithTimestamp, certificate });
    debug("Prepared JSON data for encryption");

    // Encrypt using Node.js crypto module (no file I/O needed)
    let encryptedBuffer;
    try {
      debug("Running crypto encryption...");
      const publicKeyObj = crypto.createPublicKey(pubKeyPemStr);
      encryptedBuffer = crypto.publicEncrypt(
        {
          key: publicKeyObj,
          padding: crypto.constants.RSA_PKCS1_PADDING,
        },
        Buffer.from(jsonData, "utf8"),
      );
      debug(
        "Encryption completed successfully, buffer length: %d",
        encryptedBuffer.length,
      );
    } catch (cryptoError: any) {
      debug("Encryption failed: %s", cryptoError.message);
      throw new Error(`Encryption failed: ${cryptoError.message}`);
    }

    // Convert to base64
    const encryptedBase64 = encryptedBuffer.toString("base64");
    debug(
      "Converted encrypted data to base64, length: %d",
      encryptedBase64.length,
    );

    if (!encryptedBase64) {
      throw new Error("Encrypted base64 data is empty!");
    }

    // Generate QR code
    debug("Generating QR code with size: %dx%d", size, size);
    const qrCodeBufferWithout = await QRCode.toBuffer(encryptedBase64, {
      type: "png",
      width: size,
      color: { dark: fgColor, light: bgColor },
      errorCorrectionLevel: "M",
    });

    // If no logo, return simple QR code
    if (!logo) {
      debug("QR code generated successfully without logo");
      return {
        qrCodeDataUrl: `data:image/png;base64,${qrCodeBufferWithout.toString("base64")}`,
        qrCodeBuffer: qrCodeBufferWithout,
        encryptedData: encryptedBuffer,
        encryptedBase64,
      };
    }

    // Handle logo integration
    if (typeof logo !== "string") {
      throw new Error("Logo parameter must be a string URL.");
    }

    debug("Fetching logo from URL: %s", logo);
    const response = await fetch(logo);
    if (!response.ok) {
      throw new Error(`Failed to fetch logo image from URL: ${logo}`);
    }
    const logoBufferRaw = await response.buffer();

    // Import sharp dynamically
    const sharp = await import("sharp");

    // Calculate sizes
    const logoSize = Math.floor(size * logoSizeRatio);
    const padding = Math.floor(logoSize * 0.1);
    const bgSize = logoSize + padding * 2;

    // Convert hex color to RGB for sharp
    const bgRgb = hexToRgb(bgColor);

    // Create a colored background square
    const backgroundSquare = await sharp
      .default({
        create: {
          width: bgSize,
          height: bgSize,
          channels: 4,
          background: bgRgb,
        },
      })
      .png()
      .toBuffer();

    // Process logo and composite it onto the colored background
    const logoBuffer = await sharp
      .default(backgroundSquare)
      .composite([
        {
          input: await sharp
            .default(logoBufferRaw)
            .resize(logoSize, logoSize, { fit: "contain" })
            .toBuffer(),
          gravity: "center",
        },
      ])
      .toBuffer();

    // Generate QR code with specified background color
    const qrCodeBuffer = await QRCode.toBuffer(encryptedBase64, {
      type: "png",
      width: size,
      color: { dark: fgColor, light: bgColor },
      errorCorrectionLevel: "M",
    });

    // Composite QR code with logo
    const composedBuffer = await sharp
      .default(qrCodeBuffer)
      .composite([
        {
          input: logoBuffer,
          gravity: "center",
        },
      ])
      .png()
      .toBuffer();

    debug("QR code with logo generated");
    return {
      qrCodeDataUrl: `data:image/png;base64,${composedBuffer.toString("base64")}`,
      qrCodeBuffer: composedBuffer,
      encryptedData: encryptedBuffer,
      encryptedBase64,
    };
  } catch (error: any) {
    debug("QR code generation failed: %s", error.message);
    throw new Error(`QR code generation failed: ${error.message}`);
  }
}
