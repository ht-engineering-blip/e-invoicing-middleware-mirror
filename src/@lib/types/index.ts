// Shared TypeScript types

export interface BaseDocument {
  _id?: string;
  businessId: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/**
 * Recursive type to extract all dot-notation paths of an object up to depth D.
 */
export type NestedPaths<T, D extends number = 4> = [D] extends [never]
  ? never
  : T extends object
  ? {
      [K in keyof T & (string | number)]: T[K] extends any[]
        ? `${K}`
        : T[K] extends Date | RegExp
        ? `${K}`
        : T[K] extends object
        ? `${K}` | `${K}.${NestedPaths<T[K], PrevDepth[D]>}`
        : `${K}`;
    }[keyof T & (string | number)]
  : never;

type PrevDepth = [never, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, ...0[]];

/**
 * Type utility that provides IDE autocomplete suggestions for all nested paths of T,
 * while still permitting any other arbitrary string path without type errors.
 * Automatically unwraps array types to suggest paths of the element type.
 */
export type AutocompletePaths<T> = NestedPaths<T extends (infer U)[] ? U : T> | (string & {});


