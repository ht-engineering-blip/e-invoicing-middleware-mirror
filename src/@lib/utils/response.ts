/**
 * Standardized API Response Builder
 */
export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  pages: number;
  [key: string]: any;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  meta?: PaginationMeta | Record<string, any>;
  message?: string;
  error?: string;
  statusCode?: number;
  [key: string]: any;
}

export class ResponseBuilder {
  /**
   * Build a standard successful response
   */
  static success<T>(
    data: T,
    meta?: Record<string, any>,
    message?: string,
  ): ApiResponse<T> {
    const res: ApiResponse<T> = {
      success: true,
      data,
    };
    if (meta) res.meta = meta;
    if (message) res.message = message;
    return res;
  }

  /**
   * Build a standard paginated response
   */
  static paginate<T>(
    data: T[],
    total: number,
    page: number,
    limit: number,
    extraMeta?: Record<string, any>,
  ): ApiResponse<T[]> {
    const pages = Math.ceil(total / limit) || (total === 0 ? 0 : 1);
    return {
      success: true,
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: pages,
      },
      meta: {
        total,
        page,
        limit,
        pages,
        ...extraMeta,
      },
    };
  }

  /**
   * Build a standard error response
   */
  static error(
    error: string,
    statusCode: number = 500,
    details?: any,
  ): ApiResponse<never> {
    const res: ApiResponse<never> = {
      success: false,
      error,
      statusCode,
    };
    if (details !== undefined) res.details = details;
    return res;
  }
}
