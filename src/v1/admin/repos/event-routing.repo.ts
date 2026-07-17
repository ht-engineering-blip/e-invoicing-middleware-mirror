import { AppError } from '../../../@lib';
import { EventRoutingDocument, EventRoutingModel, IEventRoute } from '../models/event-routing.model';
import crypto from 'crypto';

export class EventRoutingRepository {

  async findByTenantId(tenantId: string): Promise<EventRoutingDocument | null> {
    try {
      return await EventRoutingModel.findOne({ tenantId }).exec();
    } catch {
      throw new AppError(500, 'Failed to fetch event routing config');
    }
  }

  async upsert(tenantId: string, routes: IEventRoute[]): Promise<EventRoutingDocument> {
    try {
      const doc = await EventRoutingModel.findOneAndUpdate(
        { tenantId },
        { $set: { routes } },
        { returnDocument: 'after', upsert: true, runValidators: true }
      ).exec();
      return doc!;
    } catch {
      throw new AppError(500, 'Failed to save event routing config');
    }
  }

  async addRoute(tenantId: string, route: Omit<IEventRoute, 'routeId'>): Promise<EventRoutingDocument> {
    try {
      const routeId = crypto.randomBytes(8).toString('hex');
      const doc = await EventRoutingModel.findOneAndUpdate(
        { tenantId },
        { $push: { routes: { ...route, routeId } } },
        { returnDocument: 'after', upsert: true }
      ).exec();
      return doc!;
    } catch {
      throw new AppError(500, 'Failed to add event route');
    }
  }

  async updateRoute(
    tenantId: string,
    routeId: string,
    updates: Partial<Omit<IEventRoute, 'routeId'>>
  ): Promise<EventRoutingDocument | null> {
    try {
      const setFields: Record<string, any> = {};
      for (const [key, value] of Object.entries(updates)) {
        setFields[`routes.$.${key}`] = value;
      }
      return await EventRoutingModel.findOneAndUpdate(
        { tenantId, 'routes.routeId': routeId },
        { $set: setFields },
        { returnDocument: 'after' }
      ).exec();
    } catch {
      throw new AppError(500, 'Failed to update event route');
    }
  }

  async removeRoute(tenantId: string, routeId: string): Promise<EventRoutingDocument | null> {
    try {
      return await EventRoutingModel.findOneAndUpdate(
        { tenantId },
        { $pull: { routes: { routeId } } },
        { returnDocument: 'after' }
      ).exec();
    } catch {
      throw new AppError(500, 'Failed to remove event route');
    }
  }

  async delete(tenantId: string): Promise<boolean> {
    try {
      const result = await EventRoutingModel.findOneAndDelete({ tenantId }).exec();
      return result !== null;
    } catch {
      throw new AppError(500, 'Failed to delete event routing config');
    }
  }

  /**
   * Get all enabled routes that match a specific event type for a tenant.
   * Used by the inbound webhook handler to resolve actions.
   */
  async getRoutesForEvent(tenantId: string, event: string): Promise<IEventRoute[]> {
    try {
      const doc = await EventRoutingModel.findOne({ tenantId }).exec();
      if (!doc) return [];
      return doc.routes.filter((r: IEventRoute) => r.enabled && r.event === event);
    } catch {
      throw new AppError(500, 'Failed to fetch routes for event');
    }
  }
}
