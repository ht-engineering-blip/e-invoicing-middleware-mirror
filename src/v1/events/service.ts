import type { Server } from "bun";
import { logger } from "../../@lib/logger";

export class EventsService {
  static server: Server<any> | null = null;

  static init(server: Server<any> | null) {
    this.server = server;
  }

  /**
   * Publishes an event to a specific topic via WebSockets.
   * Clients subscribed to the topic will receive the event.
   *
   * @param topic The topic to publish to (e.g., "frontend-events")
   * @param eventType A string identifying the type of event
   * @param payload Any data payload related to the event
   */
  static publish(topic: string, eventType: string, payload: any) {
    if (this.server) {
      const message = JSON.stringify({ type: eventType, data: payload });
      this.server.publish(topic, message);
      logger.info(
        `[EventsService] Published '${eventType}' to topic '${topic}'`,
      );
    } else {
      logger.warn(
        `[EventsService] Failed to publish event '${eventType}' - Server not initialized.`,
      );
    }
  }
}
