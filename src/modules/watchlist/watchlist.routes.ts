import { Hono } from "hono";
import { getPrisma } from "../../prisma/prisma.edge";
import { jwtAuthMiddleware } from "../../common/middleware/jwt-auth.middleware";
import { BadRequestException, NotFoundException } from "../../common/http-exceptions";
import type { HonoEnv } from "../../common/types";

export const watchlistRoutes = new Hono<HonoEnv>();
watchlistRoutes.use("*", jwtAuthMiddleware);

// Ported from apiv2's watchlist-service/watchlist.service.ts — pure Prisma,
// portable as-is.

async function requireOwned(prisma: ReturnType<typeof getPrisma>, id: string, userId: string) {
  const row = await prisma.watchlist.findUnique({ where: { id } });
  if (!row || row.userId !== userId) throw new NotFoundException("Watchlist not found");
  return row;
}

watchlistRoutes.get("/", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);
  let rows = await prisma.watchlist.findMany({ where: { userId: user.sub }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });

  if (rows.length === 0) {
    const created = await prisma.watchlist.create({
      data: { userId: user.sub, name: "Favorites", symbols: ["EURUSD", "XAUUSD", "BTCUSD"], isDefault: true, sortOrder: 0 },
    });
    rows = [created];
  }

  return c.json({ watchlists: rows });
});

watchlistRoutes.post("/", async (c) => {
  const user = c.get("user")!;
  const body = await c.req.json<{ name: string; symbols?: string[] }>();
  const prisma = getPrisma(c.env);

  const existing = await prisma.watchlist.findUnique({ where: { userId_name: { userId: user.sub, name: body.name } } });
  if (existing) throw new BadRequestException(`A watchlist named "${body.name}" already exists`);

  const count = await prisma.watchlist.count({ where: { userId: user.sub } });
  const created = await prisma.watchlist.create({
    data: { userId: user.sub, name: body.name, symbols: body.symbols ?? [], isDefault: false, sortOrder: count },
  });

  return c.json(created);
});

watchlistRoutes.put("/:id/name", async (c) => {
  const user = c.get("user")!;
  const body = await c.req.json<{ name: string }>();
  const prisma = getPrisma(c.env);
  await requireOwned(prisma, c.req.param("id"), user.sub);

  const conflict = await prisma.watchlist.findUnique({ where: { userId_name: { userId: user.sub, name: body.name } } });
  if (conflict && conflict.id !== c.req.param("id")) throw new BadRequestException(`A watchlist named "${body.name}" already exists`);

  const updated = await prisma.watchlist.update({ where: { id: c.req.param("id") }, data: { name: body.name } });
  return c.json(updated);
});

watchlistRoutes.delete("/:id", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);
  const list = await requireOwned(prisma, c.req.param("id"), user.sub);
  if (list.isDefault) throw new BadRequestException("Cannot delete the default Favorites list");

  await prisma.watchlist.delete({ where: { id: list.id } });
  return c.json({ ok: true });
});

watchlistRoutes.post("/:id/symbols", async (c) => {
  const user = c.get("user")!;
  const body = await c.req.json<{ symbol: string }>();
  const prisma = getPrisma(c.env);
  const list = await requireOwned(prisma, c.req.param("id"), user.sub);
  const sym = body.symbol.toUpperCase();

  if (list.symbols.includes(sym)) return c.json(list);

  const updated = await prisma.watchlist.update({ where: { id: list.id }, data: { symbols: [...list.symbols, sym] } });
  return c.json(updated);
});

watchlistRoutes.delete("/:id/symbols/:symbol", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);
  const list = await requireOwned(prisma, c.req.param("id"), user.sub);
  const sym = c.req.param("symbol").toUpperCase();

  const updated = await prisma.watchlist.update({
    where: { id: list.id },
    data: { symbols: list.symbols.filter((s) => s !== sym) },
  });
  return c.json(updated);
});

watchlistRoutes.put("/:id/symbols", async (c) => {
  const user = c.get("user")!;
  const body = await c.req.json<{ symbols: string[] }>();
  const prisma = getPrisma(c.env);
  const list = await requireOwned(prisma, c.req.param("id"), user.sub);

  const valid = body.symbols.filter((s) => list.symbols.includes(s.toUpperCase()));
  const updated = await prisma.watchlist.update({ where: { id: list.id }, data: { symbols: valid } });
  return c.json(updated);
});

watchlistRoutes.get("/top-movers", async (c) => {
  const prisma = getPrisma(c.env);
  const limit = Math.min(parseInt(c.req.query("limit") ?? "10"), 50);
  const quotes = await prisma.quote.findMany();
  const movers = quotes
    .map((q) => ({ symbol: q.symbol, bid: q.bid.toNumber(), ask: q.ask.toNumber(), mid: q.mid.toNumber(), changePct: q.changePct.toNumber() }))
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
    .slice(0, limit);
  return c.json({ movers });
});

watchlistRoutes.get("/hot-symbols", async (c) => {
  const prisma = getPrisma(c.env);
  const limit = Math.min(parseInt(c.req.query("limit") ?? "10"), 50);
  const quotes = await prisma.quote.findMany();
  const hot = quotes
    .map((q) => ({ symbol: q.symbol, bid: q.bid.toNumber(), ask: q.ask.toNumber(), mid: q.mid.toNumber(), changePct: q.changePct.toNumber() }))
    .sort((a, b) => b.changePct - a.changePct)
    .slice(0, limit);
  return c.json({ hot });
});
