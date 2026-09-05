import bcrypt from "bcryptjs";
import { Router } from "express";
import { ILike } from "typeorm";
import { AppDataSource } from "../data-source";
import { COLOR_MODES, ColorMode, REGISTRABLE_ROLES, RegistrableRole, USER_ROLES, User, UserRole } from "../entities/User";
import { signToken } from "../auth/jwt";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth } from "../middleware/requireAuth";
import { requireRole } from "../middleware/requireRole";
import { isPgError, PG_UNIQUE_VIOLATION } from "../lib/pgError";
import { isUuid } from "../lib/uuid";
import { toEnvelope } from "../lib/listQuery";

export const authRouter = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
const DEFAULT_ROLE: RegistrableRole = "student";

function userRepo() {
  return AppDataSource.getRepository(User);
}

// The one place an email becomes storable or comparable. The users.email UNIQUE
// constraint is on the stored value, so every read and write must agree on case.
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toPublicUser(user: User) {
  return { id: user.id, email: user.email, role: user.role, colorMode: user.colorMode, active: user.active };
}

function toAdminUser(user: User) {
  return { ...toPublicUser(user), createdAt: user.createdAt };
}

const adminUsersPath = "/admin/users";
const ADMIN_USER_PAGE_SIZE = 20;
const ADMIN_USER_PAGE_MAX = 50;

function parseAdminUserList(query: Record<string, unknown>) {
  const rawPage = query.page === undefined ? 1 : Number(query.page);
  if (!Number.isInteger(rawPage) || rawPage < 1) return { error: "page must be a positive integer" };
  const page = rawPage;
  const requestedSize = Number(query.pageSize ?? ADMIN_USER_PAGE_SIZE);
  if (!Number.isInteger(requestedSize) || requestedSize < 1 || requestedSize > ADMIN_USER_PAGE_MAX) return { error: `pageSize must be a positive integer at most ${ADMIN_USER_PAGE_MAX}` };
  const pageSize = requestedSize;
  const role = typeof query.role === "string" && query.role ? query.role : undefined;
  const active = query.active === undefined || query.active === "" ? undefined : query.active === "true" ? true : query.active === "false" ? false : null;
  const q = typeof query.q === "string" ? query.q.trim() : "";
  if (role && !USER_ROLES.includes(role as UserRole)) return { error: `Role must be one of: ${USER_ROLES.join(", ")}` };
  if (active === null) return { error: "active must be true or false" };
  return { page, pageSize, role: role as UserRole | undefined, active, q };
}

authRouter.get(
  adminUsersPath,
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const parsed = parseAdminUserList(req.query as Record<string, unknown>);
    if ("error" in parsed) {
      res.status(422).json({ error: parsed.error });
      return;
    }
    const where = {
      ...(parsed.role ? { role: parsed.role } : {}),
      ...(parsed.active === undefined ? {} : { active: parsed.active }),
      ...(parsed.q ? { email: ILike(`%${parsed.q}%`) } : {}),
    };
    const repo = userRepo();
    const [users, total] = await repo.findAndCount({
      where,
      order: { createdAt: "DESC" },
      skip: (parsed.page - 1) * parsed.pageSize,
      take: parsed.pageSize,
    });
    res.json(toEnvelope(users.map(toAdminUser), parsed.page, parsed.pageSize, total));
  }),
);

authRouter.get(
  `${adminUsersPath}/:id`,
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    if (!isUuid(req.params.id)) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const user = await userRepo().findOneBy({ id: req.params.id });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json(toAdminUser(user));
  }),
);

authRouter.patch(
  `${adminUsersPath}/:id`,
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    if (!isUuid(req.params.id)) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const body = req.body ?? {};
    const hasRole = Object.prototype.hasOwnProperty.call(body, "role");
    const hasActive = Object.prototype.hasOwnProperty.call(body, "active");
    if (!hasRole && !hasActive) {
      res.status(422).json({ error: "Provide role or active" });
      return;
    }
    if (hasRole && (typeof body.role !== "string" || !USER_ROLES.includes(body.role as UserRole))) {
      res.status(422).json({ error: `Role must be one of: ${USER_ROLES.join(", ")}` });
      return;
    }
    if (hasActive && typeof body.active !== "boolean") {
      res.status(422).json({ error: "active must be a boolean" });
      return;
    }
    const user = await userRepo().findOneBy({ id: req.params.id });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    if (hasRole) user.role = body.role as UserRole;
    if (hasActive) user.active = body.active;
    await userRepo().save(user);
    res.json(toAdminUser(user));
  }),
);

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
      if (!isPgError(err, PG_UNIQUE_VIOLATION)) throw err;
      // 422, not 409: the spec's error contract is 401/403/404/422 and a
      // duplicate email is an invalid value for a field the form already
      // validates inline (story 3), not a separate conflict code.
      res.status(422).json({ error: "Email is already registered" });
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
    if (!user.active) {
      res.status(403).json({ error: "This account is deactivated" });
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

// The one thing a reader may change about their own account: which of the two
// modes of their Role Theme they see (#75). The Role Theme itself follows the
// role, so a body naming either is refused rather than ignored: `role` is the
// only privileged field on this row, and a silent drop would leave a caller
// believing it took.
authRouter.patch(
  "/auth/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { colorMode, role, theme } = req.body ?? {};

    if (role !== undefined || theme !== undefined) {
      res.status(422).json({ error: "Your role sets your Role Theme; neither can be changed here" });
      return;
    }
    if (!COLOR_MODES.includes(colorMode)) {
      res.status(422).json({ error: `Colour mode must be one of: ${COLOR_MODES.join(", ")}` });
      return;
    }

    const user = req.user!;
    user.colorMode = colorMode as ColorMode;
    await userRepo().save(user);

    res.json(toPublicUser(user));
  }),
);
