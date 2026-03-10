import mongoose, { Schema, Document } from 'mongoose';

/**
 * A single event → actions mapping rule
 */
export interface IEventRoute {
  routeId: string;
  event: string;          // event type id (e.g. 'invoice.created')
  actions: string[];      // ordered workflow action ids (e.g. ['transform', 'validate'])
  enabled: boolean;
  description?: string;
}

/**
 * Per-tenant event routing configuration document
 */
export interface EventRoutingDocument extends Document {
  tenantId: string;
  routes: IEventRoute[];
  createdAt: Date;
  updatedAt: Date;
}

const EventRouteSchema = new Schema<IEventRoute>(
  {
    routeId: { type: String, required: true },
    event: { type: String, required: true },
    actions: [{ type: String }],
    enabled: { type: Boolean, default: true },
    description: { type: String },
  },
  { _id: false }
);

const EventRoutingSchema = new Schema<EventRoutingDocument>(
  {
    tenantId: { type: String, required: true, unique: true, index: true },
    routes: [EventRouteSchema],
  },
  { timestamps: true, collection: 'event_routing_configs' }
);

export const EventRoutingModel =
  mongoose.models.EventRoutingConfig ||
  mongoose.model<EventRoutingDocument>('EventRoutingConfig', EventRoutingSchema);
