// Error handling middleware
import { Elysia } from 'elysia';
import { AppError } from '../@lib/errors';

export const errorHandlerMiddleware = new Elysia({ name: 'error-handler' })
  .onError(({ code, error, set }: any) => {
    if (error instanceof AppError) {
      set.status = error.statusCode;
      return {
        success: false,
        error: error.message,
        code: error.code,
      };
    }

    // Handle validation errors
    if (code === 'VALIDATION') {
      set.status = 400;
      return {
        success: false,
        error: 'Validation error',
        details: error.message,
      };
    }

    // Handle unknown errors
    set.status = 500;
    return {
      success: false,
      error: 'Internal server error',
      ...(process.env.NODE_ENV === 'development' && { details: error.message }),
    };
  });

