import pino from "pino";

export type LogFields = Record<string, unknown>;
export const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

export function log(level: "info" | "warn" | "error", event: string, fields: LogFields = {}): void {
  logger[level]({ event, ...fields }, event);
}
