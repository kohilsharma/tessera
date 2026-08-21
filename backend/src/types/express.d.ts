import type { User } from "../entities/User";

declare global {
  namespace Express {
    interface Request {
      // The row requireAuth loaded, not the token's claims — see requireAuth.ts.
      user?: User;
    }
  }
}

export {};
