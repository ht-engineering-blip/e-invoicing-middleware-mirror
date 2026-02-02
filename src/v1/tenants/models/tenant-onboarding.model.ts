import mongoose, { Schema, Document } from 'mongoose'; 

/**
 * Onboarding Status
 */
export enum OnboardingStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  TESTING = 'testing',
  ACTIVE = 'active',
  REJECTED = 'rejected',
}

/**
 * Onboarding Step Interface
 */
export interface IOnboardingStep {
  completed: boolean;
  completedAt?: Date;
}

/**
 * Onboarding Steps Interface
 */
export interface IOnboardingSteps {
  registration: IOnboardingStep;
  firsProvisioning: IOnboardingStep;
  erpConfiguration: IOnboardingStep;
  testing: IOnboardingStep;
  goLive: IOnboardingStep;
}

/**
 * MongoDB Document interface for Tenant Onboarding
 */
export interface TenantOnboardingDocument extends Document {
  tenantId: string;
  status: OnboardingStatus;

  // Onboarding Progress
  steps: IOnboardingSteps;

  // Metadata
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  approvedBy?: string;
  approvedAt?: Date;
}

/**
 * Mongoose Schema for Tenant Onboarding collection
 */
const TenantOnboardingSchema = new Schema<TenantOnboardingDocument>(
  {
    tenantId: {
      type: String,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(OnboardingStatus),
      default: OnboardingStatus.PENDING,
      index: true,
    },

  // Onboarding Progress
    steps: {
      registration: {
        completed: { type: Boolean, default: false },
        completedAt: { type: Date },
      },
      firsProvisioning: {
        completed: { type: Boolean, default: false },
        completedAt: { type: Date },
      },
      erpConfiguration: {
        completed: { type: Boolean, default: false },
        completedAt: { type: Date },
      },
      testing: {
        completed: { type: Boolean, default: false },
        completedAt: { type: Date },
      },
      goLive: {
        completed: { type: Boolean, default: false },
        completedAt: { type: Date },
      },
    },

    // Metadata
    createdBy: {
      type: String,
      required: true,
    },
    approvedBy: {
      type: String,
    },
    approvedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    collection: 'tenant_onboarding',
  }
);

// Indexes for performance (tenantId and status already have index: true in schema)
TenantOnboardingSchema.index({ tin: 1 });

/**
 * Tenant Onboarding Model
 */
export const TenantOnboardingModel =
  mongoose.models.TenantOnboarding ||
  mongoose.model<TenantOnboardingDocument>('TenantOnboarding', TenantOnboardingSchema);
