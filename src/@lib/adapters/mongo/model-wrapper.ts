/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { Model, Query, QueryFilter, UpdateQuery } from "mongoose";

export class ModelWrapper<T = any> {
  private model: Model<T>;

  constructor(model: Model<T>) {
    this.model = model;
  }

  find(query: QueryFilter<T> = {}, ...args: any[]): Query<T[], T> {
    return this.model.find(query, ...args);
  }

  countDocuments(query: QueryFilter<T> = {}, ...args: any[]): Query<number, T> {
    return this.model.countDocuments(query, ...args);
  }

  findOne(query: QueryFilter<T> = {}, ...args: any[]): Query<T | null, T> {
    return this.model.findOne(query, ...args);
  }

  findById(id: string, ...args: any[]): Query<T | null, T> {
    return this.model.findById(id, ...args);
  }

  findByIdAndUpdate(
    id: string,
    update: UpdateQuery<T>,
    ...args: any[]
  ): Query<T | null, T> {
    return this.model.findByIdAndUpdate(id, update, ...args);
  }

  findByIdAndDelete(id: string, ...args: any[]): Query<T | null, T> {
    return this.model.findByIdAndDelete(id, ...args);
  }

  findOneAndDelete(query: QueryFilter<T>, ...args: any[]): Query<T | null, T> {
    console.log("findOneAndDelete - query:::", JSON.stringify(query, null, 2));
    return this.model.findOneAndDelete(query, ...args);
  }

  updateOne(
    query: QueryFilter<T>,
    update: UpdateQuery<T>,
    ...args: any[]
  ): Query<any, T> {
    return this.model.updateOne(query, update, ...args);
  }

  deleteOne(query: QueryFilter<T>, ...args: any[]): Query<any, T> {
    return this.model.deleteOne(query, ...args);
  }

  // Overloads for create
  create(doc: any): Promise<T>;
  create(docs: any[]): Promise<T[]>;
  create(docOrDocs: any | any[]): Promise<T | T[]> {
    return this.model.create(docOrDocs);
  }

  // ---
  // Generic version for all models and optional tenant injection (kept for signature compatibility)
  findWithTenant(
    query: QueryFilter<T> = {},
    injectuserId = true,
    ...args: any[]
  ): Query<T[], T> {
    return this.model.find(query, ...args);
  }

  countDocumentsWithTenant(
    query: QueryFilter<T> = {},
    injectuserId = true,
    ...args: any[]
  ): Query<number, T> {
    return this.model.countDocuments(query, ...args);
  }

  findOneWithTenant(
    query: QueryFilter<T> = {},
    injectuserId = true,
    ...args: any[]
  ): Query<T | null, T> {
    return this.model.findOne(query, ...args);
  }

  findByIdWithTenant(
    id: string,
    injectuserId = true,
    ...args: any[]
  ): Query<T | null, T> {
    return this.model.findById(id, ...args);
  }

  updateOneWithTenant(
    query: QueryFilter<T>,
    update: UpdateQuery<T>,
    injectuserId = true,
    ...args: any[]
  ): Query<any, T> {
    return this.model.updateOne(query, update, ...args);
  }

  deleteOneWithTenant(
    query: QueryFilter<T>,
    injectuserId = true,
    ...args: any[]
  ): Query<any, T> {
    return this.model.deleteOne(query, ...args);
  }

  // Overloads for createWithTenant
  createWithTenant(doc: any, injectuserId?: boolean): Promise<T>;
  createWithTenant(docs: any[], injectuserId?: boolean): Promise<T[]>;
  createWithTenant(
    docOrDocs: any | any[],
    injectuserId = true,
  ): Promise<T | T[]> {
    return this.model.create(docOrDocs);
  }

  // Additional methods needed for e-invoicing modules
  findOneAndUpdate(
    query: QueryFilter<T>,
    update: UpdateQuery<T>,
    ...args: any[]
  ): Query<T | null, T> {
    return this.model.findOneAndUpdate(query, update, ...args);
  }

  aggregate(pipeline: any[]): any {
    return this.model.aggregate(pipeline);
  }

  bulkWrite(ops: any[], ...args: any[]): Promise<any> {
    console.log("bulkWrite - ops count:::", ops.length);
    return this.model.bulkWrite(ops, ...args);
  }

  updateMany(
    query: QueryFilter<T>,
    update: UpdateQuery<T>,
    ...args: any[]
  ): Query<any, T> {
    return this.model.updateMany(query, update, ...args);
  }

  deleteMany(query: QueryFilter<T>, ...args: any[]): Query<any, T> {
    return this.model.deleteMany(query, ...args);
  }

  count(query: QueryFilter<T> = {}, ...args: any[]): Query<number, T> {
    return this.model.countDocuments(query, ...args);
  }

  get base(): Model<T> {
    return this.model;
  }
}
