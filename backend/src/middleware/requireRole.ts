import { NextFunction, Request, Response } from "express";
import type { UserRole } from "../entities/User";

// Must run after requireAuth: it reads req.user, it does not authenticate.
// Missing req.user is a wiring bug (route forgot requireAuth), not a normal
// request path, but 401 is still the honest status for "no identity" over 403.
export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: "You do not have access to this resource" });
      return;
    }
    next();
  };
}
