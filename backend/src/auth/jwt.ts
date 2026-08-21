import jwt from "jsonwebtoken";
import type { UserRole } from "../entities/User";

// ADR-0013: single JWT access token, no refresh rotation.
const EXPIRES_IN = "24h";

// Resolved per call rather than at module load, so a caller that loads this
// module before the environment is ready (tests, any future bootstrap order)
// still gets the real secret. There is deliberately no development fallback: a
// signing key that ships in source is a forgeable token.
function resolveSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not set — copy backend/.env.example to backend/.env (see SETUP.md).");
  }
  return secret;
}

export type AuthTokenPayload = {
  sub: string;
  role: UserRole;
};

// expiresIn is overridable so tests can mint a genuinely-expired token through
// the real signing path instead of re-hardcoding a secret of their own.
export function signToken(
  payload: AuthTokenPayload,
  expiresIn: jwt.SignOptions["expiresIn"] = EXPIRES_IN,
): string {
  return jwt.sign(payload, resolveSecret(), { expiresIn });
}

export function verifyToken(token: string): AuthTokenPayload {
  return jwt.verify(token, resolveSecret()) as AuthTokenPayload;
}
