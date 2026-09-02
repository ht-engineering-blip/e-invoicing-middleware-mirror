import { Agenda, computeJobState } from "agenda";
import { MongoBackend, MongoJobRepository } from "@agendajs/mongo-backend";
import { databaseConfig } from "../../@config/database";
import { logger } from "../logger";
import { TIME_MS } from "../constants";

// High-performance MongoJobRepository getJobsOverview override.
// Default @agendajs/mongo-backend implementation fetches ALL job documents into memory
// using find({ name }).toArray(), which hangs when the database accumulates thousands of jobs.
MongoJobRepository.prototype.getJobsOverview = async function (this: any) {
  const now = new Date();
  const overviews = await this.collection
    .aggregate([
      {
        $group: {
          _id: "$name",
          total: { $sum: 1 },
          running: {
            $sum: { $cond: [{ $ne: ["$lockedAt", null] }, 1, 0] },
          },
          scheduled: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$lockedAt", null] },
                    { $gt: ["$nextRunAt", now] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          queued: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$lockedAt", null] },
                    { $lte: ["$nextRunAt", now] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          completed: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ["$lastFinishedAt", null] },
                    { $eq: ["$failedAt", null] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          failed: {
            $sum: { $cond: [{ $ne: ["$failedAt", null] }, 1, 0] },
          },
          repeating: {
            $sum: { $cond: [{ $ne: ["$repeatInterval", null] }, 1, 0] },
          },
          paused: {
            $sum: { $cond: [{ $eq: ["$disabled", true] }, 1, 0] },
          },
        },
      },
      {
        $project: {
          _id: 0,
          name: "$_id",
          total: 1,
          running: 1,
          scheduled: 1,
          queued: 1,
          completed: 1,
          failed: 1,
          repeating: 1,
          paused: 1,
        },
      },
    ])
    .toArray();

  return overviews;
};

// High-performance queryJobs override supporting DB-level state filtering, allowDiskUse & pagination.
// Fixes "Sort exceeded memory limit of 33554432 bytes" error on large collections.
MongoJobRepository.prototype.queryJobs = async function (
  this: any,
  options: any = {},
) {
  const {
    name,
    names,
    state,
    id,
    ids,
    search,
    data,
    includeDisabled = true,
    sort,
    skip = 0,
    limit = 50,
  } = options;
  const now = new Date();
  const query: any = {};

  if (name && typeof name === "string") {
    query.name = name;
  } else if (names && Array.isArray(names) && names.length > 0) {
    query.name = { $in: names.filter((n: any) => typeof n === "string") };
  }

  if (search && typeof search === "string" && search.length > 0) {
    query.name = {
      $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      $options: "i",
    };
  }

  if (!includeDisabled) {
    query.disabled = { $ne: true };
  }

  // Map state filter directly to MongoDB query criteria for DB-level filtering & pagination
  if (state === "completed") {
    query.lastFinishedAt = { $ne: null };
    query.failedAt = null;
  } else if (state === "failed") {
    query.failedAt = { $ne: null };
  } else if (state === "running") {
    query.lockedAt = { $ne: null };
  } else if (state === "scheduled") {
    query.lockedAt = null;
    query.nextRunAt = { $gt: now };
  } else if (state === "queued") {
    query.lockedAt = null;
    query.nextRunAt = { $lte: now };
  } else if (state === "repeating") {
    query.repeatInterval = { $ne: null };
  } else if (state === "paused") {
    query.disabled = true;
  }

  // Ensure sorting returns most recent jobs first (_id timestamp / lastRunAt)
  // Default Agendash passes sort: { nextRunAt: 'desc' }, which places 5-month-old completed jobs at top.
  let mongoSort: any = { _id: -1 };
  if (sort) {
    if (sort.nextRunAt === "desc" || sort.nextRunAt === -1) {
      mongoSort = { _id: -1 };
    } else {
      mongoSort = this.toMongoSort(sort);
      if (!mongoSort._id) mongoSort._id = -1;
    }
  }

  // allowDiskUse(true) prevents memory limit exceptions during sorting on unindexed large collections
  let cursor = this.collection.find(query).sort(mongoSort).allowDiskUse(true);
  if (skip > 0) cursor = cursor.skip(skip);
  if (limit > 0) cursor = cursor.limit(limit);

  const [pageJobs, total] = await Promise.all([
    cursor.toArray(),
    this.collection.countDocuments(query),
  ]);

  const jobs = pageJobs.map((job: any) => {
    const jobOb = {
      _id: job._id?.toString(),
      name: job.name,
      priority: job.priority,
      nextRunAt: job.nextRunAt,
      type: job.type,
      data: job.data,
      lockedAt: job.lockedAt ?? undefined,
      lastFinishedAt: job.lastFinishedAt ?? undefined,
      failedAt: job.failedAt ?? undefined,
      failCount: job.failCount ?? undefined,
      failReason: job.failReason ?? undefined,
      repeatTimezone: job.repeatTimezone ?? undefined,
      lastRunAt: job.lastRunAt ?? undefined,
      repeatInterval: job.repeatInterval ?? undefined,
      disabled: job.disabled ?? undefined,
      progress: job.progress ?? undefined,
    };
    return {
      ...jobOb,
      state: computeJobState(jobOb, now),
    };
  });

  return { jobs, total };
};

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
  defaultLockLifetime: TIME_MS.FIVE_MINUTES, // 5 min max per job
  logging: true,
});

agenda.on("ready", async () => {
  logger.info("[Queue] Agenda connected to MongoDB");
  try {
    const col = (agenda.db as any)?.collection;
    if (col) {
      await col
        .createIndex({ nextRunAt: -1, priority: -1 }, { background: true })
        .catch(() => {});
      await col
        .createIndex({ name: 1, nextRunAt: -1 }, { background: true })
        .catch(() => {});
      await col
        .createIndex(
          { lastFinishedAt: 1, failedAt: 1, nextRunAt: -1 },
          { background: true },
        )
        .catch(() => {});
      await col
        .createIndex({ failedAt: 1, nextRunAt: -1 }, { background: true })
        .catch(() => {});
    }
  } catch (err) {
    logger.warn("[Queue] Index check completed", { err });
  }
});

agenda.on("error", (err: any) =>
  logger.error("[Queue] Agenda connection error", { err }),
);
