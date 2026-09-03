import "reflect-metadata";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { AppDataSource } from "../src/data-source";
import { signToken } from "../src/auth/jwt";
import { setupTestDb } from "./setupTestDb";

setupTestDb();

const app = () => createApp();

describe("POST /api/v1/auth/register", () => {
  it("registers a new Student and returns a token", async () => {
    const res = await request(app())
      .post("/api/v1/auth/register")
      .send({ email: "student@example.com", password: "correct-horse", role: "student" });

    expect(res.status).toBe(201);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ email: "student@example.com", role: "student" });
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it("accepts email + password alone, defaulting to the Student role", async () => {
    const res = await request(app())
      .post("/api/v1/auth/register")
      .send({ email: "no-role@example.com", password: "correct-horse" });

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: "no-role@example.com", role: "student" });
  });

  it("stores the email lowercased, so case cannot duplicate an account", async () => {
    const created = await request(app())
      .post("/api/v1/auth/register")
      .send({ email: "MixedCase@Example.com", password: "correct-horse" });

    expect(created.status).toBe(201);
    expect(created.body.user.email).toBe("mixedcase@example.com");

    const again = await request(app())
      .post("/api/v1/auth/register")
      .send({ email: "mixedcase@example.com", password: "correct-horse" });

    expect(again.status).toBe(422);
  });

  it("rejects a duplicate email with 422", async () => {
    await request(app())
      .post("/api/v1/auth/register")
      .send({ email: "dupe@example.com", password: "correct-horse", role: "student" });

    const res = await request(app())
      .post("/api/v1/auth/register")
      .send({ email: "dupe@example.com", password: "another-password", role: "investor" });

    expect(res.status).toBe(422);
  });

  it("answers concurrent duplicate registrations with 201 + 422, not a crash", async () => {
    const send = () =>
      request(app())
        .post("/api/v1/auth/register")
        .send({ email: "race@example.com", password: "correct-horse", role: "student" });

    const statuses = (await Promise.all([send(), send()])).map((res) => res.status).sort();

    expect(statuses).toEqual([201, 422]);
  });

  it("rejects an invalid email with 422", async () => {
    const res = await request(app())
      .post("/api/v1/auth/register")
      .send({ email: "not-an-email", password: "correct-horse", role: "student" });

    expect(res.status).toBe(422);
  });

  it("rejects a weak password with 422", async () => {
    const res = await request(app())
      .post("/api/v1/auth/register")
      .send({ email: "weak@example.com", password: "short", role: "student" });

    expect(res.status).toBe(422);
  });

  it("rejects an invalid role with 422", async () => {
    const res = await request(app())
      .post("/api/v1/auth/register")
      .send({ email: "admin-attempt@example.com", password: "correct-horse", role: "admin" });

    expect(res.status).toBe(422);
  });
});

describe("POST /api/v1/auth/login", () => {
  it("logs in with correct credentials and returns a token", async () => {
    await request(app())
      .post("/api/v1/auth/register")
      .send({ email: "login-ok@example.com", password: "correct-horse", role: "investor" });

    const res = await request(app())
      .post("/api/v1/auth/login")
      .send({ email: "login-ok@example.com", password: "correct-horse" });

    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ email: "login-ok@example.com", role: "investor" });
  });

  it("logs in regardless of the case the email is typed in", async () => {
    await request(app())
      .post("/api/v1/auth/register")
      .send({ email: "case-login@example.com", password: "correct-horse" });

    const res = await request(app())
      .post("/api/v1/auth/login")
      .send({ email: "Case-Login@Example.com", password: "correct-horse" });

    expect(res.status).toBe(200);
  });

  it("rejects wrong password with 401", async () => {
    await request(app())
      .post("/api/v1/auth/register")
      .send({ email: "login-bad@example.com", password: "correct-horse", role: "student" });

    const res = await request(app())
      .post("/api/v1/auth/login")
      .send({ email: "login-bad@example.com", password: "wrong-password" });

    expect(res.status).toBe(401);
  });

  it("rejects an unknown email with 401", async () => {
    const res = await request(app())
      .post("/api/v1/auth/login")
      .send({ email: "nobody@example.com", password: "correct-horse" });

    expect(res.status).toBe(401);
  });
});

describe("GET /api/v1/auth/me", () => {
  it("rejects a request with no token with 401", async () => {
    const res = await request(app()).get("/api/v1/auth/me");
    expect(res.status).toBe(401);
  });

  it("rejects a malformed token with 401", async () => {
    const res = await request(app()).get("/api/v1/auth/me").set("Authorization", "Bearer not-a-jwt");
    expect(res.status).toBe(401);
  });

  it("rejects an expired token with 401", async () => {
    // Signed through the real signing path, so this fails only on expiry — not
    // on a signature mismatch from a secret the test invented.
    const expired = signToken({ sub: "00000000-0000-0000-0000-000000000000", role: "student" }, "-1s");

    const res = await request(app()).get("/api/v1/auth/me").set("Authorization", `Bearer ${expired}`);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid or expired token");
  });

  it("rejects a valid token whose user has been deleted with 401", async () => {
    const orphan = signToken({ sub: "00000000-0000-0000-0000-000000000000", role: "student" });

    const res = await request(app()).get("/api/v1/auth/me").set("Authorization", `Bearer ${orphan}`);

    expect(res.status).toBe(401);
  });

  it("returns the current user for a valid token", async () => {
    const registerRes = await request(app())
      .post("/api/v1/auth/register")
      .send({ email: "me@example.com", password: "correct-horse", role: "student" });

    const res = await request(app())
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${registerRes.body.token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: "me@example.com", role: "student" });
  });

  it("reports a new account as following the reader's own colour scheme", async () => {
    const registerRes = await request(app())
      .post("/api/v1/auth/register")
      .send({ email: "fresh-mode@example.com", password: "correct-horse" });

    expect(registerRes.body.user.colorMode).toBe("system");

    const res = await request(app())
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${registerRes.body.token}`);

    expect(res.body.colorMode).toBe("system");
  });
});

describe("PATCH /api/v1/auth/me", () => {
  async function accountFor(email: string, role = "student") {
    const res = await request(app())
      .post("/api/v1/auth/register")
      .send({ email, password: "correct-horse", role });
    return res.body.token as string;
  }

  it("rejects a request with no token with 401", async () => {
    const res = await request(app()).patch("/api/v1/auth/me").send({ colorMode: "dark" });
    expect(res.status).toBe(401);
  });

  it("stores the light/dark override and hands it back", async () => {
    const token = await accountFor("mode-set@example.com");

    const patched = await request(app())
      .patch("/api/v1/auth/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ colorMode: "dark" });

    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ email: "mode-set@example.com", colorMode: "dark" });

    // Read back through the other route: the override is on the row, not in a
    // response the client happened to keep.
    const me = await request(app()).get("/api/v1/auth/me").set("Authorization", `Bearer ${token}`);
    expect(me.body.colorMode).toBe("dark");
  });

  it("takes 'system' back, so an override can be released", async () => {
    const token = await accountFor("mode-release@example.com");

    await request(app())
      .patch("/api/v1/auth/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ colorMode: "light" });
    const released = await request(app())
      .patch("/api/v1/auth/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ colorMode: "system" });

    expect(released.status).toBe(200);
    expect(released.body.colorMode).toBe("system");
  });

  it("rejects a mode outside the three with 422, leaving the stored one alone", async () => {
    const token = await accountFor("mode-bad@example.com");

    const res = await request(app())
      .patch("/api/v1/auth/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ colorMode: "sepia" });

    expect(res.status).toBe(422);
    const me = await request(app()).get("/api/v1/auth/me").set("Authorization", `Bearer ${token}`);
    expect(me.body.colorMode).toBe("system");
  });

  // The theme is a property of who you are (DESIGN.md §3, #75). Enforced here
  // rather than only hidden in the UI, and refused out loud rather than dropped
  // in silence — a PATCH that ignores a field it was sent is the defect spec §6
  // files against PATCH /briefs.
  it("refuses to change the role, so a reader cannot pick their own theme", async () => {
    const token = await accountFor("theme-grab@example.com");

    const res = await request(app())
      .patch("/api/v1/auth/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ colorMode: "dark", role: "admin" });

    expect(res.status).toBe(422);
    const me = await request(app()).get("/api/v1/auth/me").set("Authorization", `Bearer ${token}`);
    expect(me.body).toMatchObject({ role: "student", colorMode: "system" });
  });
});
