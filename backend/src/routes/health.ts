import { Router } from "express";
import { AppDataSource } from "../data-source";

export const healthRouter = Router();

healthRouter.get("/health", async (_req, res) => {
  let dbOk = true;
  try {
    await AppDataSource.query("SELECT 1");
  } catch (err) {
    console.error("Health check database round-trip failed", err);
    dbOk = false;
  }
  const state = dbOk ? "ok" : "error";
  res.status(dbOk ? 200 : 500).json({ status: state, db: state, timestamp: new Date().toISOString() });
});
