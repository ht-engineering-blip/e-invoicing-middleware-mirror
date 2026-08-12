import { ModelWrapper } from "../../../@lib/adapters/mongo/model-wrapper";
import {
  WebhookNonceDocument,
  WebhookNonceModel,
} from "../models/webhook-nonce.model";

export class WebhookNonceRepository {
  private webhookNonceModel: ModelWrapper<WebhookNonceDocument>;

  constructor() {
    this.webhookNonceModel = new ModelWrapper<WebhookNonceDocument>(
      WebhookNonceModel,
    );
  }

  /**
   * Find a webhook nonce by tenant ID, timestamp, and signature to check for replays
   */
  async findOne(query: {
    tenantId: string;
    t: number;
    v1: string;
  }): Promise<WebhookNonceDocument | null> {
    try {
      const doc = await this.webhookNonceModel.findOne(query).exec();
      return doc;
    } catch (error) {
      console.error("Error finding webhook nonce:", error);
      return null;
    }
  }

  /**
   * Persist a webhook nonce to prevent replay attacks
   */
  async create(data: {
    tenantId: string;
    t: number;
    v1: string;
  }): Promise<WebhookNonceDocument> {
    try {
      const doc = await this.webhookNonceModel.create(data);
      return doc;
    } catch (error: any) {
      console.error("Error creating webhook nonce:", error);
      throw error;
    }
  }
}
