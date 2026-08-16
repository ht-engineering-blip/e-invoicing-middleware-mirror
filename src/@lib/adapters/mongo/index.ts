import mongoose from "mongoose";
import { Elysia } from "elysia";
import { databaseConfig } from "../../../@config";

let cachedConnectionPromise: Promise<typeof mongoose> | null = null;

export const mongoPlugin = new Elysia({ name: "mongo-plugin" })
  .onBeforeHandle({ as: "global" }, async () => {
    await connectMongo();
  });

export const connectMongo = async () => {
  if (mongoose.connection.readyState === 1) {
    return mongoose;
  }

  if (cachedConnectionPromise) {
    return cachedConnectionPromise;
  }

  const mongoUri = databaseConfig?.data?.mongoUri as string;
  if (!mongoUri) {
    throw new Error("MongoDB URI is not configured in database config");
  }

  cachedConnectionPromise = mongoose
    .connect(mongoUri, {
      dbName: databaseConfig?.data?.dbName,
      maxPoolSize: 10,
      minPoolSize: 1,
      socketTimeoutMS: 15000,
      connectTimeoutMS: 8000,
      serverSelectionTimeoutMS: 8000,
    })
    .then((m) => {
      console.info(
        `MongoDB connected successfully to database: ${databaseConfig?.data?.dbName}`,
      );
      return m;
    })
    .catch((err: any) => {
      console.error("MongoDB connection error:", err);
      cachedConnectionPromise = null;
      throw err;
    });

  return cachedConnectionPromise;
};

// Handle connection events
mongoose.connection.on("connected", () => {
  console.info("Mongoose connected to MongoDB");
});

mongoose.connection.on("error", (err) => {
  console.error("Mongoose connection error:", err);
});

mongoose.connection.on("disconnected", () => {
  console.warn("Mongoose disconnected from MongoDB");
});

// Graceful shutdown
process.on("SIGINT", async () => {
  await mongoose.connection.close();
  console.info("Mongoose connection closed due to app termination");
  process.exit(0);
});

export default mongoose;
