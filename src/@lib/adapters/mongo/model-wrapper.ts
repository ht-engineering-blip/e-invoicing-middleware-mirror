/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable @typescript-eslint/no-unused-vars */ 
import { Model, Query, UpdateQuery } from 'mongoose';

export class ModelWrapper<T = any> {
  private model: Model<T>;
  private businessId: string | null = null;
  
  constructor(model: Model<T>) {
    try { 
    } catch (error) {
      console.log('No session user found, using default business ID');
    }
    this.model = model; 
  }

  find(query: any = {}, ...args: any[]): Query<T[], T> { 
    console.log('find - query:::', JSON.stringify({  ...query , businessId: this.businessId }, null, 2));
    return this.model.find({  ...query , businessId: this.businessId }, ...args);
  }
  countDocuments(query: any = {}, ...args: any[]): Query<number, T> { 
    console.log({query})
    return this.model.countDocuments({ $and: [ ...query , { businessId: this.businessId }] }, ...args);
  }

  findOne(query: any = {}, ...args: any[]): Query<T | null, T> { 
    console.log('findOne - query:::', JSON.stringify({  ...query , businessId: this.businessId }, null, 2));
    return this.model.findOne({  ...query , businessId: this.businessId }, ...args);
  }

  findById(id: any, ...args: any[]): Query<T | null, T> {
    return this.model.findOne({ _id: id, businessId: this.businessId }, ...args);
  }

  findByIdAndUpdate(id: any, update: UpdateQuery<T>, ...args: any[]): Query<T | null, T> {
    return this.model.findByIdAndUpdate({ _id: id, businessId: this.businessId }, update, ...args);
  }

  findByIdAndDelete(id: any, ...args: any[]): Query<T | null, T> {
    return this.model.findByIdAndDelete({ _id: id, businessId: this.businessId }, ...args);
  }

  updateOne(query: any, update: UpdateQuery<T>, ...args: any[]): Query<any, T> {
    return this.model.updateOne({ ...query, businessId: this.businessId }, update, ...args);
  }

  deleteOne(query: any, ...args: any[]): Query<any, T> {
    return this.model.deleteOne({ ...query, businessId: this.businessId }, ...args);
  }

  // Overloads for create
  create(doc: any): Promise<T>;
  create(docs: any[]): Promise<T[]>;
  create(docOrDocs: any | any[]): Promise<T | T[]> { 
    if (Array.isArray(docOrDocs)) {
      return this.model.create(docOrDocs.map(doc => ({ ...doc, businessId: this.businessId})));
    }
    console.log({ ...docOrDocs, businessId: this.businessId+' empty' })
    return this.model.create({ ...docOrDocs, businessId: this.businessId });
  }

  // ---
  // Generic version for all models and optional businessId: this.businessId injection
  findWithTenant(query: any = {}, injectuserId = true, ...args: any[]): Query<T[], T> {
    return this.model.find(injectuserId ? { ...query, businessId: this.businessId } : query, ...args);
  }
  
  countDocumentsWithTenant(query: any = {},injectuserId = true, ...args: any[]): Query<number, T> { 
    return this.model.countDocuments(injectuserId ? { ...query, businessId: this.businessId } : query, ...args);
  }

  findOneWithTenant(query: any = {}, injectuserId = true, ...args: any[]): Query<T | null, T> {
    return this.model.findOne(injectuserId ? { ...query, businessId: this.businessId } : query, ...args);
  }

  findByIdWithTenant(id: any, injectuserId = true, ...args: any[]): Query<T | null, T> {
    return injectuserId
      ? this.model.findOne({ _id: id, businessId: this.businessId }, ...args)
      : this.model.findById(id, ...args);
  }

  updateOneWithTenant(query: any, update: UpdateQuery<T>, injectuserId = true, ...args: any[]): Query<any, T> {
    return this.model.updateOne(injectuserId ? { ...query, businessId: this.businessId } : query, update, ...args);
  }

  deleteOneWithTenant(query: any, injectuserId = true, ...args: any[]): Query<any, T> {
    return this.model.deleteOne(injectuserId ? { ...query, businessId: this.businessId } : query, ...args);
  }

  // Overloads for createWithTenant
  createWithTenant(doc: any, injectuserId?: boolean): Promise<T>;
  createWithTenant(docs: any[], injectuserId?: boolean): Promise<T[]>;
  createWithTenant(docOrDocs: any | any[], injectuserId = true): Promise<T | T[]> {
    if (Array.isArray(docOrDocs)) {
      return this.model.create(
        injectuserId
          ? docOrDocs.map(doc => ({ ...doc, businessId: this.businessId }))
          : docOrDocs
      );
    }
    return this.model.create(
      injectuserId ? { ...docOrDocs, businessId: this.businessId } : docOrDocs
    );
  }

  // Additional methods needed for e-invoicing modules
  findOneAndUpdate(query: any, update: UpdateQuery<T>, ...args: any[]): Query<T | null, T> {
    console.log(JSON.stringify({...query,  businessId: this.businessId },null, 2))
    return this.model.findOneAndUpdate({...query,  businessId: this.businessId }, update, ...args);
  }

  aggregate(pipeline: any[]): any {
    // Add businessId: this.businessId filter to the first stage if it's a $match stage
    if (pipeline.length > 0 && pipeline[0].$match) {
      pipeline[0].$match = { ...pipeline[0].$match, businessId: this.businessId };
    } else {
      // Insert a $match stage at the beginning
      pipeline.unshift({ $match: { businessId: this.businessId } });
    }
    return this.model.aggregate(pipeline);
  }

  updateMany(query: any, update: UpdateQuery<T>, ...args: any[]): Query<any, T> {
    return this.model.updateMany({ ...query, businessId: this.businessId }, update, ...args);
  }

  deleteMany(query: any, ...args: any[]): Query<any, T> {
    return this.model.deleteMany({ ...query, businessId: this.businessId }, ...args);
  }

  count(query: any = {}, ...args: any[]): Query<number, T> {
    return this.model.countDocuments({ ...query, businessId: this.businessId }, ...args);
  }

  get base(): Model<T> {
    return this.model;
  }
}