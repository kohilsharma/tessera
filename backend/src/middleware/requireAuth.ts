import { AppDataSource } from "../data-source";
import { User } from "../entities/User";
import { verifyToken } from "../auth/jwt";
import { asyncHandler } from "./asyncHandler";

// Authenticates off the current users row, not off the token's claims. A 24h
// token (ADR-0013) carries a role that goes stale the moment a user is promoted,
// demoted, or deleted, and every downstream guard — requireRole included — would
// keep honouring it for the rest of that day. One lookup per authenticated
// request buys revocation that actually works.
export const requireAuth = asyncHandler(async (req, res, next) => {
  const header = req.header("authorization");
  const [scheme, token] = header?.split(" ") ?? [];
  if (scheme !== "Bearer" || !token) {
    res.status(401).json({ error: "Missing or malformed Authorization header" });
    return;
  }

  let userId: string;
  try {
    userId = verifyToken(token).sub;
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  const user = await AppDataSource.getRepository(User).findOne({ where: { id: userId } });
  if (!user) {
    // 401, not ADR-0013's 404: the endpoint exists, it is the bearer's identity
    // that is gone. The client must drop the token and log in again, which is
    // what the SPA's 401 interceptor does — a 404 would strand a dead token in
    // localStorage.
    res.status(401).json({ error: "Token identifies a user that no longer exists" });
    return;
  }

  if (!user.active) {
    res.status(401).json({ error: "This account is deactivated" });
    return;
  }

  req.user = user;
  next();
});
