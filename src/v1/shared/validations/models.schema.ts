import { t } from "elysia";

export const TenantSchema = t.Object({
  _id: t.Optional(t.Any()),
  tenantId: t.Optional(t.String()),
  businessName: t.Optional(t.String()),
  tin: t.Optional(t.String()),
  status: t.Optional(t.String()),
  contactEmail: t.Optional(t.String()),
  contactPhone: t.Optional(t.String()),
  erpSystem: t.Optional(t.String()),
  businessRegistrationNumber: t.Optional(t.String()),
  expectedVolume: t.Optional(t.Number()),
  webhookUrl: t.Optional(t.String()),
  webhookEnabled: t.Optional(t.Boolean()),
  webhookAuth: t.Optional(t.String()),
  createdAt: t.Optional(t.Any()),
  updatedAt: t.Optional(t.Any()),
  metadata: t.Optional(t.Record(t.String(), t.Any())),
  config: t.Optional(t.Record(t.String(), t.Any())),
  serviceId: t.Optional(t.String()),
});

export const WebhookEventSchema = t.Object({
  _id: t.Optional(t.Any()),
  eventId: t.Optional(t.String()),
  tenantId: t.Optional(t.String()),
  eventType: t.Optional(t.String()),
  payload: t.Optional(t.Record(t.String(), t.Any())),
  status: t.Optional(t.String()),
  attempts: t.Optional(t.Number()),
  nextAttempt: t.Optional(t.Any()),
  createdAt: t.Optional(t.Any()),
  updatedAt: t.Optional(t.Any()),
});

export const InvoiceSchema = t.Object({
  _id: t.Optional(t.Any()),
  tenantId: t.Optional(t.String()),
  businessId: t.Optional(t.String()),
  irn: t.Optional(t.String()),
  invoiceNumber: t.Optional(t.String()),
  invoice: t.Optional(t.Record(t.String(), t.Any())),
  status: t.Optional(t.String()),
  paymentStatus: t.Optional(t.String()),
  workflowState: t.Optional(t.Record(t.String(), t.Boolean())),
  metadata: t.Optional(t.Record(t.String(), t.Any())),
  createdAt: t.Optional(t.Any()),
  updatedAt: t.Optional(t.Any()),
});

export const SystemConfigSchema = t.Object({
  _id: t.Optional(t.Any()),
  configId: t.Optional(t.String()),
  version: t.Optional(t.Number()),
  firsSchema: t.Optional(t.Record(t.String(), t.Any())),
  globalSettings: t.Optional(t.Record(t.String(), t.Any())),
  createdAt: t.Optional(t.Any()),
  updatedAt: t.Optional(t.Any()),
});

export const TeamMemberSchema = t.Object({
  _id: t.Optional(t.Any()),
  tenantId: t.Optional(t.String()),
  userId: t.Optional(t.String()),
  role: t.Optional(t.String()),
  email: t.Optional(t.String()),
  name: t.Optional(t.String()),
  status: t.Optional(t.String()),
  createdAt: t.Optional(t.Any()),
  updatedAt: t.Optional(t.Any()),
});
