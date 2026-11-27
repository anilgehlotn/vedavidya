import type { NextFunction, Request, Response } from "express";
/** Express 4 doesn't catch errors from async handlers: route them to the error handler instead of crashing. */
export const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };
