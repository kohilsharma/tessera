import { Router } from "express";
import { AppDataSource } from "../data-source";
import { WatchlistItem, WATCHLIST_KINDS, type WatchlistKind } from "../entities/WatchlistItem";
import { STORY_CATEGORIES } from "../entities/Story";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth } from "../middleware/requireAuth";
import { requireRole } from "../middleware/requireRole";
import { isPgError, PG_UNIQUE_VIOLATION } from "../lib/pgError";
import { normalizeTicker } from "../market/MarketProvider";

export const watchlistRouter = Router();
watchlistRouter.use("/watchlist", requireAuth, requireRole("investor"));

function toPublic(item: WatchlistItem) {
  return { id: item.id, kind: item.kind, value: item.value, createdAt: item.createdAt };
}

function parseItem(body: unknown): { ok: true; kind: WatchlistKind; value: string } | { ok: false; error: string } {
  const input = (body ?? {}) as Record<string, unknown>;
  if (!WATCHLIST_KINDS.includes(input.kind as WatchlistKind)) return { ok: false, error: "kind must be sector or ticker" };
  if (typeof input.value !== "string" || input.value.trim() === "") return { ok: false, error: "value is required" };
  if (input.kind === "sector") {
    const value = input.value.trim().toLowerCase();
    if (!STORY_CATEGORIES.includes(value as (typeof STORY_CATEGORIES)[number])) return { ok: false, error: "value must be a valid Story category" };
    return { ok: true, kind: "sector", value };
  }
  const value = normalizeTicker(input.value);
  return value ? { ok: true, kind: "ticker", value } : { ok: false, error: "value must be a valid Ticker" };
}

watchlistRouter.get("/watchlist", asyncHandler(async (req, res) => {
  const items = await AppDataSource.getRepository(WatchlistItem).find({ where: { ownerId: req.user!.id }, order: { createdAt: "ASC" } });
  res.json({ items: items.map(toPublic) });
}));

watchlistRouter.post("/watchlist", asyncHandler(async (req, res) => {
  const parsed = parseItem(req.body);
  if (!parsed.ok) {
    res.status(422).json({ error: parsed.error });
    return;
  }
  try {
    const item = await AppDataSource.getRepository(WatchlistItem).save({ ownerId: req.user!.id, kind: parsed.kind, value: parsed.value });
    res.status(201).json(toPublic(item));
  } catch (error) {
    if (isPgError(error, PG_UNIQUE_VIOLATION)) {
      res.status(409).json({ error: "That item is already on your watchlist" });
      return;
    }
    throw error;
  }
}));

watchlistRouter.delete("/watchlist/:id", asyncHandler(async (req, res) => {
  const repo = AppDataSource.getRepository(WatchlistItem);
  const item = await repo.findOne({ where: { id: req.params.id, ownerId: req.user!.id } });
  if (!item) {
    res.status(404).json({ error: "Watchlist item not found" });
    return;
  }
  await repo.remove(item);
  res.status(204).send();
}));
