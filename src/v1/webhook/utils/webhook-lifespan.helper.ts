export enum WebhookLifespan {
  THIRTY_DAYS = "30_DAYS",
  NINETY_DAYS = "90_DAYS",
  ONE_HUNDRED_EIGHTY_DAYS = "180_DAYS",
  ONE_YEAR = "1_YEAR",
  NO_EXPIRATION = "NO_EXPIRATION",
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface WebhookExpiryResult {
  lifespan: WebhookLifespan;
  expiresAt?: Date;
}

/**
 * Calculates expiration date based on the chosen webhook lifespan.
 * Supported options:
 * - 30_DAYS / 30d
 * - 90_DAYS / 90d
 * - 180_DAYS / 180d
 * - 1_YEAR / 1y
 * - NO_EXPIRATION / never
 */
export function calculateWebhookExpiry(
  lifespan?: string,
): WebhookExpiryResult {
  if (!lifespan) {
    return {
      lifespan: WebhookLifespan.NO_EXPIRATION,
      expiresAt: undefined,
    };
  }

  const normalized = lifespan.trim().toUpperCase();

  switch (normalized) {
    case "30_DAYS":
    case "30DAYS":
    case "30D":
    case "30":
      return {
        lifespan: WebhookLifespan.THIRTY_DAYS,
        expiresAt: new Date(Date.now() + 30 * MS_PER_DAY),
      };

    case "90_DAYS":
    case "90DAYS":
    case "90D":
    case "90":
      return {
        lifespan: WebhookLifespan.NINETY_DAYS,
        expiresAt: new Date(Date.now() + 90 * MS_PER_DAY),
      };

    case "180_DAYS":
    case "180DAYS":
    case "180D":
    case "180":
      return {
        lifespan: WebhookLifespan.ONE_HUNDRED_EIGHTY_DAYS,
        expiresAt: new Date(Date.now() + 180 * MS_PER_DAY),
      };

    case "1_YEAR":
    case "1YEAR":
    case "1Y":
    case "365D":
    case "365_DAYS":
    case "365":
      return {
        lifespan: WebhookLifespan.ONE_YEAR,
        expiresAt: new Date(Date.now() + 365 * MS_PER_DAY),
      };

    case "NO_EXPIRATION":
    case "NOEXPIRATION":
    case "NEVER":
    case "NONE":
      return {
        lifespan: WebhookLifespan.NO_EXPIRATION,
        expiresAt: undefined,
      };

    default:
      return {
        lifespan: WebhookLifespan.NO_EXPIRATION,
        expiresAt: undefined,
      };
  }
}

/**
 * Checks if a webhook expiration date is in the past.
 */
export function isWebhookExpired(expiresAt?: Date | string | null): boolean {
  if (!expiresAt) {
    return false;
  }
  const expiryTime = new Date(expiresAt).getTime();
  if (isNaN(expiryTime)) {
    return false;
  }
  return expiryTime <= Date.now();
}
