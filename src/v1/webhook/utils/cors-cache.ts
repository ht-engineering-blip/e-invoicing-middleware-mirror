import { TenantModel } from '../../tenants/models/tenant.model';

export const webhookPathToOriginCache = new Map<string, string>();

export async function preloadWebhookOrigins() {
  try {
    const tenants = await TenantModel.find({
      $or: [
        { 'config.webhookEnabled': true },
        { webhookEnabled: true }
      ]
    }).exec();

    for (const tenant of tenants) {
      const webhookPath = tenant.metadata?.webhookPath;
      const webhookUrl = tenant.config?.webhookUrl || tenant.webhookUrl;
      if (webhookPath && webhookUrl) {
        try {
          const origin = new URL(String(webhookUrl)).origin;
          webhookPathToOriginCache.set(webhookPath, origin);
        } catch {}
      }
    }
    console.info(`[CORS Cache] Preloaded ${webhookPathToOriginCache.size} webhook origins`);
  } catch (err) {
    console.error('Failed to preload webhook origins:', err);
  }
}
