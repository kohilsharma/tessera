import express from "express";
import { healthRouter } from "./routes/health";

export function createApp() {
  const app = express();
  app.use("/api/v1", healthRouter);
  return app;
}
