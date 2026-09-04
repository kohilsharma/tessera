import { Router } from "express";
import { AppDataSource } from "../data-source";
import { log } from "../lib/logger";

export const healthRouter = Router();

healthRouter.get("/health", async (_req, res) => {
  let dbOk = true;
  try {
    await AppDataSource.query("SELECT 1");
  } catch {
    log("error", "health.database_failed", { errorCode: "database_unavailable", resultStatus: 500 });
    dbOk = false;
  }
  const state = dbOk ? "ok" : "error";
  res.status(dbOk ? 200 : 500).json({ status: state, db: state, timestamp: new Date().toISOString() });
});
