import bcrypt from "bcryptjs";
import { Router } from "express";
import { AppDataSource } from "../data-source";
import { REGISTRABLE_ROLES, RegistrableRole, User } from "../entities/User";
import { signToken } from "../auth/jwt";
import { requireAuth } from "../middleware/requireAuth";

export const authRouter = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

function userRepo() {
  return AppDataSource.getRepository(User);
}

function toPublicUser(user: User) {
  return { id: user.id, email: user.email, role: user.role };
}

authRouter.post("/auth/register", async (req, res) => {
  const { email, password, role } = req.body ?? {};

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

  const normalizedEmail = email.toLowerCase();
  const existing = await userRepo().findOne({ where: { email: normalizedEmail } });
  if (existing) {
    res.status(409).json({ error: "Email is already registered" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await userRepo().save({
    email: normalizedEmail,
    passwordHash,
    role: role as RegistrableRole,
  });

  const token = signToken({ sub: user.id, role: user.role });
  res.status(201).json({ token, user: toPublicUser(user) });
});

authRouter.post("/auth/login", async (req, res) => {
  const { email, password } = req.body ?? {};

  if (typeof email !== "string" || typeof password !== "string") {
    res.status(422).json({ error: "Email and password are required" });
    return;
  }

  const user = await userRepo().findOne({ where: { email: email.toLowerCase() } });
  const passwordMatches = user ? await bcrypt.compare(password, user.passwordHash) : false;
  if (!user || !passwordMatches) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const token = signToken({ sub: user.id, role: user.role });
  res.json({ token, user: toPublicUser(user) });
});

authRouter.get("/auth/me", requireAuth, async (req, res) => {
  const user = await userRepo().findOne({ where: { id: req.user!.id } });
  if (!user) {
    res.status(401).json({ error: "User no longer exists" });
    return;
  }
  res.json(toPublicUser(user));
});
