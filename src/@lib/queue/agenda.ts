import { Agenda } from "agenda";
import { MongoBackend } from "@agendajs/mongo-backend";
import { databaseConfig } from "../../@config/database";
import { logger } from "../logger";

const mongoUri = databaseConfig?.data?.mongoUri!;

/**
 * Shared Agenda instance backed by the same MongoDB as the application.
 * Import and call agenda.start() only from the worker process.
 * The API process uses it only to schedule jobs (no .start() call).
 */
export const agenda = new Agenda({
  backend: new MongoBackend({
    address: mongoUri,
    collection: "job_queue",
  }),
  processEvery: "2 seconds",
  defaultConcurrency: 5,
  maxConcurrency: 20,
  defaultLockLifetime: 5 * 60 * 1000, // 5 min max per job
  logging: true,
});

agenda.on("ready", () => logger.info("[Queue] Agenda connected to MongoDB"));
agenda.on("error", (err: any) =>
  logger.error("[Queue] Agenda connection error", { err }),
);
