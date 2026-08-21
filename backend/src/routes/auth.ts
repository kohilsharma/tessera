import bcrypt from "bcryptjs";
import { Router } from "express";
import { AppDataSource } from "../data-source";
import { REGISTRABLE_ROLES, RegistrableRole, User } from "../entities/User";
import { signToken } from "../auth/jwt";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth } from "../middleware/requireAuth";

export const authRouter = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
const DEFAULT_ROLE: RegistrableRole = "student";
const PG_UNIQUE_VIOLATION = "23505";

function userRepo() {
  return AppDataSource.getRepository(User);
}

// The one place an email becomes storable or comparable. The users.email UNIQUE
// constraint is on the stored value, so every read and write must agree on case.
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// TypeORM wraps the driver error but also copies its properties onto
// QueryFailedError; read both so this does not depend on which.
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; driverError?: { code?: string } } | null;
  return (e?.code ?? e?.driverError?.code) === PG_UNIQUE_VIOLATION;
}

function toPublicUser(user: User) {
  return { id: user.id, email: user.email, role: user.role };
}

authRouter.post(
  "/auth/register",
  asyncHandler(async (req, res) => {
    // Role is optional: #17 asks that email + password alone be enough to
    // register, so an omitted role means the least-privileged registrable one.
    const { email, password, role = DEFAULT_ROLE } = req.body ?? {};

    if (typeof email !== "string" || !EMAIL_RE.test(email)) {
      res.status(422).json({ error: "A valid email is required" });
      return;
    }
    if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
      res.status(422).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
      return;
    }
    if (!REGISTRABLE_ROLES.includes(role)) {
      res.status(422).json({ error: `Role must be one of: ${REGISTRABLE_ROLES.join(", ")}` });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);

    let user: User;
    try {
      // No read-then-write duplicate check: it loses the race whenever two
      // registrations for the same email overlap. The UNIQUE constraint is the
      // only real guard, so let it fire and translate it.
      user = await userRepo().save({
        email: normalizeEmail(email),
        passwordHash,
        role: role as RegistrableRole,
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      res.status(409).json({ error: "Email is already registered" });
      return;
    }

    res.status(201).json({ token: signToken({ sub: user.id, role: user.role }), user: toPublicUser(user) });
  }),
);

authRouter.post(
  "/auth/login",
  asyncHandler(async (req, res) => {
    const { email, password } = req.body ?? {};

    if (typeof email !== "string" || typeof password !== "string") {
      res.status(422).json({ error: "Email and password are required" });
      return;
    }

    const user = await userRepo().findOne({ where: { email: normalizeEmail(email) } });
    // Compare unconditionally-shaped: one message for both misses, so the
    // response never reveals whether the email exists.
    const passwordMatches = user ? await bcrypt.compare(password, user.passwordHash) : false;
    if (!user || !passwordMatches) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    res.json({ token: signToken({ sub: user.id, role: user.role }), user: toPublicUser(user) });
  }),
);

// requireAuth has already loaded the row and 401'd a token whose user is gone,
// so there is nothing left to look up here.
authRouter.get("/auth/me", requireAuth, (req, res) => {
  res.json(toPublicUser(req.user!));
});
