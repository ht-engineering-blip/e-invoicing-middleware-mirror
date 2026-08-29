import "./bun-v8-polyfill";
import dns from "node:dns";

// Only set custom DNS in local development if explicitly requested
if (
  process.env.FORCE_PUBLIC_DNS === "true" &&
  !process.env.VERCEL &&
  process.env.NODE_ENV !== "production"
) {
  try {
    dns.setServers(["1.1.1.1", "1.0.0.1", "8.8.8.8", "8.8.4.4"]);
  } catch (e) {
    // ignore
  }
}

import { Elysia } from "elysia";
import { appConfig, docsConfig } from "./@config";
import { v1Routes } from "./v1";
import { docsAuthMiddleware, errorHandlerMiddleware } from "./middlewares";
import { logger } from "./@lib/logger";
import { mongoPlugin, connectMongo } from "./@lib/adapters/mongo";
import { dts } from "elysia-remote-dts";
import { cors } from "@elysiajs/cors";
import { openapi } from "@elysiajs/openapi";
import mongoose from "mongoose";

if (!appConfig) {
  throw new Error("App configuration is not defined");
}

// Eagerly connect to MongoDB on app boot
connectMongo().catch((err) => {
  logger.error("Initial MongoDB connection error:", err);
});

// elysia-remote-dts pulls in the full TypeScript compiler via a CJS require()
// inside an ESM async hook, which crashes on Bun in production (Vercel) with
// "Requested module is not instantiated yet". It's a dev-only convenience
// (serves live .d.ts types), so only wire it in outside production. Passing
// an empty Elysia() as a no-op keeps this a single unbroken method chain.
const dtsPlugin =
  process.env.NODE_ENV !== "production" ? dts("./src/index.ts") : new Elysia();

const openapiPlugin = docsConfig.enabled
  ? openapi({
      path: "/openapi",
      documentation: {
        info: {
          title: "E-Invoicing Middleware API",
          version: "1.0.53",
          description:
            "Enterprise FIRS-Compliant E-Invoicing & ERP Orchestration Middleware",
        },
        tags: [
          { name: "Invoicing", description: "FIRS Invoicing & QR Endpoints" },
          { name: "Webhooks", description: "ERP & Inbound Webhooks" },
          { name: "Tenants", description: "Tenant & Onboarding Operations" },
          { name: "Admin", description: "Super Admin & Event Routing" },
        ],
      },
    })
  : new Elysia();

const app = new Elysia()
  .use(
    cors({
      origin: true,
      credentials: true,
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "x-api-key",
        "x-admin-key",
        "x-docs-password",
      ],
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    }),
  )
  .use(mongoPlugin)
  .use(dtsPlugin)
  .use(docsAuthMiddleware)
  .use(openapiPlugin)
  .use(errorHandlerMiddleware)
  .use(v1Routes)
  .get(
    "/",
    () => ({
      success: true,
      message: "E-Invoicing Middleware API",
      version: "1.0.1",
      apiVersion: appConfig?.apiVersion,
    }),
    {
      detail: {
        hide: true,
      },
    },
  )
  .get(
    "/health",
    async ({ set }) => {
      try {
        await connectMongo();
      } catch (e) {
        // ignore
      }
      const isMongoConnected = mongoose.connection.readyState === 1;
      if (!isMongoConnected) {
        set.status = 503;
      }
      return {
        success: isMongoConnected,
        status: isMongoConnected ? "UP" : "DOWN",
        timestamp: new Date().toISOString(),
        services: {
          mongodb: isMongoConnected ? "connected" : "disconnected",
        },
      };
    },
    {
      detail: {
        summary: "Health Check",
        description: "Check api health and MongoDB connection status",
      },
    },
  )
  .onError(({ code, error, set }) => {
    // Handle validation errors
    if (code === "VALIDATION") {
      set.status = 400;

      const validationError = error as any;

      const fieldErrors: Record<string, string> = {};
      if (validationError.all && Array.isArray(validationError.all)) {
        validationError.all.forEach((err: any) => {
          console.log({ err: err });
          const field = err.path?.replace("/", "") || "unknown";
          fieldErrors[field] = err.summary || err.message;
        });
      }

      return {
        success: false,
        error: "Validation failed",
        statusCode: 400,
        details: {
          on: validationError.on || "body",
          message: "Validation error: Invalid request data",
          fields: fieldErrors,
        },
      };
    }

    // Handle not found errors
    if (code === "NOT_FOUND") {
      set.status = 404;
      return {
        success: false,
        error: "Resource not found",
        statusCode: 404,
        message: "The requested endpoint does not exist",
      };
    }

    // Handle internal errors
    if (code === "INTERNAL_SERVER_ERROR") {
      set.status = 500;
      logger.error("Internal server error:", error);
      const errorObj = error as any;
      return {
        success: false,
        error: "Internal server error",
        statusCode: 500,
        message:
          appConfig?.env === "development"
            ? errorObj.message
            : "An unexpected error occurred",
      };
    }

    // Handle parse errors (invalid JSON, etc.)
    if (code === "PARSE") {
      set.status = 400;
      return {
        success: false,
        error: "Invalid request format",
        statusCode: 400,
        message: "Failed to parse request body. Please check your JSON syntax.",
      };
    }

    // Default error handler
    const errorObj = error as any;
    logger.error(`[Unhandled Error - ${code}]:`, error);
    const status = errorObj.statusCode || errorObj.status || 500;
    set.status = status;
    return {
      success: false,
      error: errorObj.message || "An error occurred",
      message: errorObj.message || "An error occurred",
      code: errorObj.code || code || "INTERNAL_SERVER_ERROR",
      statusCode: status,
      ...(errorObj.details ? { details: errorObj.details } : {}),
    };
  });

// For local development with Bun
if (import.meta.env?.DEV || process.env.NODE_ENV === "development") {
  await connectMongo().catch((err) => {
    logger.error("Failed to connect to MongoDB on startup:", err);
  });

  app.listen(appConfig.port, () => {
    logger.info(`Server is running on port ${appConfig?.port}`);
  });

  logger.info(
    `🦊 Elysia is running at http://${appConfig.host}:${appConfig.port}`,
  );
  logger.info(`API Version: ${appConfig.apiVersion}`);
  logger.info(`Environment: ${appConfig.env}`);
}

// Export for Vercel serverless deployment
export type App = typeof app;
export default app;
