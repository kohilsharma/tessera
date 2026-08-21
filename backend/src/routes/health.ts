import { Router } from "express";
import { AppDataSource } from "../data-source";

export const healthRouter = Router();

healthRouter.get("/health", async (_req, res) => {
  try {
    await AppDataSource.query("SELECT 1");
    res.status(200).json({ status: "ok", db: "ok", timestamp: new Date().toISOString() });
  } catch {
    res.status(500).json({ status: "error", db: "error", timestamp: new Date().toISOString() });
  }
});
