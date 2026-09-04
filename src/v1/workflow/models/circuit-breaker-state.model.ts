import mongoose, { Schema, Document } from "mongoose";

/**
 * Circuit Breaker State
 */
export enum CircuitBreakerState {
  CLOSED = "CLOSED",
  OPEN = "OPEN",
  HALF_OPEN = "HALF_OPEN",
}

/**
 * Circuit Breaker State Interface
 *
 * One document per breaker key (tenant + provider), so a rate limit on one
 * tenant's LLM provider cannot block transforms for every other tenant, and
 * so the state is shared by every API/worker process instead of living in
 * one process's memory.
 */
export interface ICircuitBreakerState {
  /** Breaker key, e.g. "transformer:<tenantId>:<provider>" */
  key: string;
  state: CircuitBreakerState;
  failureCount: number;
  /** Epoch millis of the most recent recorded failure */
  lastFailureTime: number;
  lastError?: string;
}

export interface CircuitBreakerStateDocument
  extends ICircuitBreakerState,
    Document {
  createdAt: Date;
  updatedAt: Date;
}

const CircuitBreakerStateSchema = new Schema<CircuitBreakerStateDocument>(
  {
    key: { type: String, required: true, unique: true, index: true },
    state: {
      type: String,
      enum: Object.values(CircuitBreakerState),
      default: CircuitBreakerState.CLOSED,
    },
    failureCount: { type: Number, default: 0 },
    lastFailureTime: { type: Number, default: 0 },
    lastError: { type: String },
  },
  {
    timestamps: true,
    collection: "circuit_breaker_state",
  },
);

// Breaker state is disposable — drop rows that have been idle for a day.
CircuitBreakerStateSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 86_400 });

export const CircuitBreakerStateModel =
  mongoose.models.CircuitBreakerState ||
  mongoose.model<CircuitBreakerStateDocument>(
    "CircuitBreakerState",
    CircuitBreakerStateSchema,
  );
