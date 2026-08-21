import { NextFunction, Request, Response } from "express";
import { verifyToken } from "../auth/jwt";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header("authorization");
  const [scheme, token] = header?.split(" ") ?? [];
  if (scheme !== "Bearer" || !token) {
    res.status(401).json({ error: "Missing or malformed Authorization header" });
    return;
  }

  try {
    const payload = verifyToken(token);
    req.user = { id: payload.sub, role: payload.role };
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
