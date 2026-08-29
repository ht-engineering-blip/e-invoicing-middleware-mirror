import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { appConfig } from "../../../@config/app";
import { inboundWebhookRoutes } from "./inbound-webhook.routes";
import { webhookEventsRoutes } from "./webhook-events.routes";

export const webhookRoutes = new Elysia({ prefix: "/webhook" })
  .use(
    cors({
      origin: (request) => {
        const origin = request.headers.get("origin");
        if (!origin) return false;
        const allowedOrigins = [
          appConfig?.webAppURL,
          "http://localhost:3000",
          "http://localhost:3001",
          "http://localhost:3002",
        ].filter(Boolean);
        return allowedOrigins.includes(origin);
      },
    }),
  )
  .use(inboundWebhookRoutes)
  .use(webhookEventsRoutes);

export { inboundWebhookRoutes, webhookEventsRoutes };
