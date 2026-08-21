import type { NextFunction, Request, RequestHandler, Response } from "express";

// Express 4 does not catch a rejected promise from an async handler: the
// rejection goes unhandled and takes the process down instead of reaching the
// error middleware. Every async route handler must go through this.
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
