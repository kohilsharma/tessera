import "reflect-metadata";
import bcrypt from "bcryptjs";
import { AppDataSource } from "./data-source";
import { User, USER_ROLES } from "./entities/User";

// ADR-0015: `npm run seed` so the demo is never empty. Admin is deliberately not
// registrable through /auth/register (it is assigned, not self-served), so this
// is the only way an Admin exists in a running app — without it the Admin
// dashboard and its role guard are only reachable from a test fixture. Stories
// and Briefs join this as the tickets that create them land.
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "tessera-demo";

async function seed(): Promise<void> {
  await AppDataSource.initialize();
  const users = AppDataSource.getRepository(User);
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);

  // Idempotent: re-running after a migration or a partial demo must not 409 on
  // the email UNIQUE constraint, and must not silently reset a changed password.
  for (const role of USER_ROLES) {
    const email = `${role}@tessera.local`;
    if (await users.findOne({ where: { email } })) {
      console.log(`= ${email} already seeded (${role})`);
      continue;
    }
    await users.save({ email, passwordHash, role });
    console.log(`+ ${email} (${role})`);
  }

  console.log(`\nDemo login password for all seeded users: ${SEED_PASSWORD}`);
  await AppDataSource.destroy();
}

seed().catch((err) => {
  console.error("Seed failed", err);
  process.exit(1);
});
