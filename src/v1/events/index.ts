import { Elysia } from "elysia";
// @ts-ignore
import { websocket } from "@elysiajs/websocket";
import { logger } from "../../@lib/logger";

export const eventsRoutes = new Elysia({ prefix: "/events" })
  // @ts-ignore
  .use(websocket())
  .ws("/ws", {
    open(ws: any) {
      logger.info("WebSocket connected to /v1/events/ws");
    },
    message(ws: any, message: any) {
      try {
        const data = typeof message === "string" ? JSON.parse(message) : message;
        
        // Let the frontend subscribe to topics, e.g. {"action": "subscribe", "topic": "frontend-events"}
        if (data.action === "subscribe" && data.topic) {
          ws.subscribe(data.topic);
          logger.info(`WebSocket subscribed to topic: ${data.topic}`);
        }
      } catch (err) {
        logger.error("Error parsing websocket message", { err });
      }
    },
    close(ws: any) {
      logger.info("WebSocket disconnected from /v1/events/ws");
    },
  });
