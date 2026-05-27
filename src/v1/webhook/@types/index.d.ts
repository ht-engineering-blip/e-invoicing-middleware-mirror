interface DeliverWebhookInput {
    eventId: string;
}

interface RetryWebhookInput {
    eventId: string;
}

interface ConfigureWebhookInput {
    tenantId: string;
    webhookUrl: string;
    webhookSecret?: string;
    enabled: boolean;
}

interface TestWebhookInput {
    tenantId: string;
    eventType: string;
    payload?: any;
}
