import { Request, Response, NextFunction } from 'express';
import { ZodType } from 'zod';

const VALIDATION_STATUS_CODE = 422;

export function validateBody(schema: ZodType) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      res.status(VALIDATION_STATUS_CODE).json({
        message: 'Validation failed',
        errors: result.error.flatten(),
      });
      return;
    }

    req.body = result.data;
    next();
  };
}

export function validateQuery(schema: ZodType) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);

    if (!result.success) {
      res.status(VALIDATION_STATUS_CODE).json({
        message: 'Validation failed',
        errors: result.error.flatten(),
      });
      return;
    }

    res.locals.query = result.data;
    next();
  };
}

export function validateParams(schema: ZodType) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);

    if (!result.success) {
      res.status(VALIDATION_STATUS_CODE).json({
        message: 'Validation failed',
        errors: result.error.flatten(),
      });
      return;
    }

    next();
  };
}
