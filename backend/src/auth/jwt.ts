import jwt from "jsonwebtoken";
import type { UserRole } from "../entities/User";

// Mirrors the fail-loudly-outside-tests pattern in data-source.ts.
function resolveSecret(): string {
  const secret = process.env.JWT_SECRET ?? (process.env.NODE_ENV === "test" ? "test-secret" : undefined);
  if (!secret) {
    throw new Error("JWT_SECRET is not set — copy backend/.env.example to backend/.env (see SETUP.md).");
  }
  return secret;
}

const JWT_SECRET = resolveSecret();

// ADR-0013: single JWT access token, no refresh rotation.
const EXPIRES_IN = "24h";

export type AuthTokenPayload = {
  sub: string;
  role: UserRole;
};

export function signToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: EXPIRES_IN });
}

export function verifyToken(token: string): AuthTokenPayload {
  return jwt.verify(token, JWT_SECRET) as AuthTokenPayload;
}
