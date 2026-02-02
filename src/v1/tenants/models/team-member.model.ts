import mongoose, { Schema, Document } from 'mongoose';

/**
 * Team Member Role
 */
export enum TeamMemberRole {
  OWNER = 'owner',
  ADMIN = 'admin',
  MEMBER = 'member',
  VIEWER = 'viewer',
}

/**
 * Team Member Status
 */
export enum TeamMemberStatus {
  INVITED = 'invited',
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
}

/**
 * Team Member Document Interface
 */
export interface TeamMemberDocument extends Document {
  tenantId: string;
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: TeamMemberRole;
  status: TeamMemberStatus;
  password?: string;
  invitationToken?: string;
  invitedAt: Date;
  invitedBy: string;
  acceptedAt?: Date;
  permissions: string[];
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Mongoose Schema for Team Members
 */
const TeamMemberSchema = new Schema<TeamMemberDocument>(
  {
    tenantId: {
      type: String,
      required: true,
      index: true,
    },
    userId: {
      type: String,
      required: true,
      unique: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
    },
    firstName: {
      type: String,
      required: true,
    },
    lastName: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: Object.values(TeamMemberRole),
      default: TeamMemberRole.MEMBER,
    },
    status: {
      type: String,
      enum: Object.values(TeamMemberStatus),
      default: TeamMemberStatus.INVITED,
    },
    password: {
      type: String,
    },
    invitationToken: {
      type: String,
    },
    invitedAt: {
      type: Date,
      default: Date.now,
    },
    invitedBy: {
      type: String,
      required: true,
    },
    acceptedAt: {
      type: Date,
    },
    permissions: {
      type: [String],
      default: [],
    },
    lastLoginAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    collection: 'team_members',
  }
);

// Indexes
TeamMemberSchema.index({ tenantId: 1, email: 1 }, { unique: true });
TeamMemberSchema.index({ tenantId: 1, status: 1 });
TeamMemberSchema.index({ invitationToken: 1 });

/**
 * Team Member Model
 */
export const TeamMemberModel =
  mongoose.models.TeamMember ||
  mongoose.model<TeamMemberDocument>('TeamMember', TeamMemberSchema);
