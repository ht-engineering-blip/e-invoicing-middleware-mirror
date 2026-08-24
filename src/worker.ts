import "./bun-v8-polyfill";
/**
 * Job Worker Process
 *
 * Run with:
 *   bun run worker          (production)
 *   bun run worker:dev      (watch mode)
 *
 * This process connects to MongoDB, registers all Agenda job definitions,
 * and processes queued jobs. It is intentionally separate from the API
 * server so both can be scaled independently.
 */

import dns from "node:dns";

if (process.env.FORCE_PUBLIC_DNS === "true") {
  dns.setServers(["1.1.1.1", "1.0.0.1", "8.8.8.8", "8.8.4.4"]);
}

import express from "express";
import { createExpressMiddleware } from "agendash";
import { connectMongo } from "./@lib/adapters/mongo";
import { agenda } from "./@lib/queue/agenda";
import { registerAllJobs } from "./v1/workflow/jobs";
import { logger } from "./@lib/logger";
import { aiConfig } from "./@config";

const AGENDASH_PORT = Number(process.env.AGENDASH_PORT ?? 3001);

async function startWorker() {
  logger.info("[Worker] Starting job worker...");

  console.log(aiConfig);

  // 1. Connect to MongoDB
  await connectMongo();
  logger.info("[Worker] MongoDB connected");

  // 2. Register all job definitions BEFORE agenda.start()
  registerAllJobs();
  logger.info("[Worker] All job definitions registered");

  // 3. Start processing
  await agenda.start();
  logger.info("[Worker] Agenda started — listening for jobs");

  // 4. Mount Agendash dashboard on a dedicated Express server
  const dashApp = express();

  // Intercept SSE real-time events endpoint to prevent browser EventSource 501 infinite reconnect loop
  dashApp.get("/api/events", (_req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.write('event: connected\ndata: {"connected":true}\n\n');
  });

  dashApp.use("/", createExpressMiddleware(agenda));
  dashApp.listen(AGENDASH_PORT, () => {
    logger.info(
      `[Worker] Agendash running at http://localhost:${AGENDASH_PORT}`,
    );
  });

  // 5. Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`[Worker] ${signal} received — stopping gracefully`);
    await agenda.stop();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // 5. Surface unhandled rejections
  process.on("unhandledRejection", (reason) => {
    logger.error("[Worker] Unhandled rejection", { reason });
  });
}

startWorker().catch((err) => {
  logger.error("[Worker] Failed to start", { err });
  process.exit(1);
});
function parseAiConfig(): any {
  throw new Error("Function not implemented.");
}
