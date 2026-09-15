interface CreateTenantInput {
    businessName: string;
    tin: string;
    businessRegistrationNumber: string;
    contactEmail: string;
    contactPhone: string;
    erpSystem: SchemaSourceType | string;
    expectedVolume?: number;
    erpWebhookUrl?: string;
    erpApiKey?: string;
    webhookUrl?: string;
}

interface UpdateTenantInput {
    businessName?: string;
    contactEmail?: string;
    password?: string;
    passwordChangedAt?: Date;
    erpSystem?: SchemaSourceType | string;
    contactPhone?: string;
    erpWebhookUrl?: string;
    erpApiKey?: string;
    webhookUrl?: string;
    webhookEnabled?: boolean;
    webhookAuthMode?: string;
    defaultEventType?: string;
    webhookExpiresAt?: Date;
    webhookLifespan?: string;
    features?: {
        autoFix?: boolean;
        maxRetries?: number;
        qrCodeGeneration?: boolean;
    };
    limits?: {
        monthlyInvoiceLimit?: number;
        apiRateLimit?: number;
    };
    metadata?: any;
    config?: any;
    status?: TenantStatus | string;
}

interface FIRSCredentialsInput {
    clientId?: string;
    serviceId?: string;
    certificate?: string;
    publicKey?: string;
    apiKey?: string;
    apiSecret?: string;
}

interface CreateApiKeyInput {
    name: string;
    scopes?: string[];
    expiresInDays?: number;
}

interface UpdateOnboardingInput {
    status?: "pending" | "in_progress" | "testing" | "active" | "rejected";
    notes?: string;
    rejectionReason?: string;
}

interface ERPSyncConfigInput {
    name: string;
    description?: string;
    enabled: boolean;
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    baseUrl: string;
    endpoint: string;
    headers?: Record<string, string>;
    queryParams?: Record<string, string>;
    bodyTemplate?: string;
    authentication?: {
        type: "none" | "basic" | "bearer" | "api-key" | "oauth2";
        username?: string;
        password?: string;
        token?: string;
        apiKeyName?: string;
        apiKeyValue?: string;
        apiKeyLocation?: "header" | "query";
    };
    timeout?: number;
    retryConfig?: {
        maxRetries: number;
        retryDelay: number;
        retryOn?: number[];
    };
    responseMapping?: Record<string, string>;
    triggerEvents?: string[];
}