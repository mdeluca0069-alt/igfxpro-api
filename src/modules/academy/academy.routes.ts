import { Hono } from "hono";
import { getPrisma } from "../../prisma/prisma.edge";
import { jwtAuthMiddleware } from "../../common/middleware/jwt-auth.middleware";
import { NotFoundException } from "../../common/http-exceptions";
import type { HonoEnv } from "../../common/types";

// Ported from apiv2's academy-service/academy.service.ts, real DB-backed
// (AcademyContent/UserAcademyProgress). One correction vs. the apiv2 source:
// that file JSON.stringify/parses the `sections`/`caseStudies`/`resources`
// fields as if they were String columns, but apiv2's own schema.prisma (the
// one we copied wholesale in Fase 0) types them as native `Json` — so here
// they're read/written directly with no stringify/parse step.

export const academyRoutes = new Hono<HonoEnv>();

const TIER_LEVEL_MAP: Record<string, string> = {
  STANDARD: "beginner",
  GOLD: "intermediate",
  PLATINUM: "advanced",
  VIP: "advanced",
  ENTERPRISE: "advanced",
};

academyRoutes.get("/content", async (c) => {
  const prisma = getPrisma(c.env);
  const category = c.req.query("category");
  const level = c.req.query("level");
  const contentType = c.req.query("contentType");
  const limit = parseInt(c.req.query("limit") ?? "20");
  const offset = parseInt(c.req.query("offset") ?? "0");

  const where: Record<string, unknown> = { isPublished: true };
  if (category) where.category = category;
  if (level) where.level = level;
  if (contentType) where.contentType = contentType;

  const [content, total] = await Promise.all([
    prisma.academyContent.findMany({ where, orderBy: { publishedAt: "desc" }, take: limit, skip: offset }),
    prisma.academyContent.count({ where }),
  ]);

  return c.json({ content, total, limit, offset });
});

academyRoutes.get("/content/:id", async (c) => {
  const prisma = getPrisma(c.env);
  const content = await prisma.academyContent.findUnique({ where: { id: c.req.param("id") } });
  if (!content) throw new NotFoundException("Content not found");

  const updated = await prisma.academyContent.update({ where: { id: content.id }, data: { viewCount: { increment: 1 } } });
  return c.json({ content: updated });
});

academyRoutes.get("/category/:category", async (c) => {
  const prisma = getPrisma(c.env);
  const category = c.req.param("category");
  const content = await prisma.academyContent.findMany({ where: { category, isPublished: true }, orderBy: { publishedAt: "desc" } });
  return c.json({ category, count: content.length, content });
});

academyRoutes.get("/related/:contentId", async (c) => {
  const prisma = getPrisma(c.env);
  const content = await prisma.academyContent.findUnique({ where: { id: c.req.param("contentId") } });
  if (!content || content.relatedContent.length === 0) return c.json({ content: [] });

  const related = await prisma.academyContent.findMany({ where: { id: { in: content.relatedContent }, isPublished: true } });
  return c.json({ content: related });
});

academyRoutes.get("/stats", async (c) => {
  const prisma = getPrisma(c.env);
  const [totalContent, allProgress, completedProgress, avgRating] = await Promise.all([
    prisma.academyContent.count({ where: { isPublished: true } }),
    prisma.userAcademyProgress.findMany({ distinct: ["userId"], select: { userId: true } }),
    prisma.userAcademyProgress.count({ where: { completed: true } }),
    prisma.academyContent.aggregate({ where: { isPublished: true, rating: { not: null } }, _avg: { rating: true } }),
  ]);

  return c.json({
    totalContent,
    uniqueUsers: new Set(allProgress.map((p) => p.userId)).size,
    totalCompletions: completedProgress,
    avgRating: avgRating._avg.rating?.toNumber() ?? 0,
    categories: ["olos_101", "autopilot_mt5", "risk_management", "trading_psychology", "case_studies"],
  });
});

academyRoutes.use("/learning-path", jwtAuthMiddleware);
academyRoutes.get("/learning-path", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);
  const dbUser = await prisma.user.findUnique({ where: { id: user.sub }, select: { tier: true } });
  const tier = dbUser?.tier ?? "STANDARD";
  const recommendedLevel = TIER_LEVEL_MAP[tier] ?? "beginner";

  const [allContent, userProgress] = await Promise.all([
    prisma.academyContent.findMany({ where: { isPublished: true, level: recommendedLevel } }),
    prisma.userAcademyProgress.findMany({ where: { userId: user.sub } }),
  ]);

  const completedIds = new Set(userProgress.filter((p) => p.completed).map((p) => p.contentId));
  const recommended = allContent
    .filter((cnt) => !completedIds.has(cnt.id))
    .sort((a, b) => (a.contentType === "course" ? 0 : 1) - (b.contentType === "course" ? 0 : 1))
    .slice(0, 5);

  return c.json({
    tier,
    recommendedLevel,
    suggested: recommended,
    completedCount: completedIds.size,
    totalCount: allContent.length,
  });
});

academyRoutes.use("/progress", jwtAuthMiddleware);
academyRoutes.get("/progress", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);
  const progress = await prisma.userAcademyProgress.findMany({ where: { userId: user.sub }, orderBy: { updatedAt: "desc" } });

  return c.json({
    completed: progress.filter((p) => p.completed).length,
    inProgress: progress.filter((p) => !p.completed && p.progress.toNumber() > 0).length,
    notStarted: progress.filter((p) => p.progress.toNumber() === 0).length,
    total: progress.length,
    items: progress,
  });
});

academyRoutes.post("/progress", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);
  const body = await c.req.json<{ contentId: string; progress: number; notes?: string }>();

  const updated = await prisma.userAcademyProgress.upsert({
    where: { userId_contentId: { userId: user.sub, contentId: body.contentId } },
    create: {
      userId: user.sub,
      contentId: body.contentId,
      progress: body.progress,
      completed: body.progress >= 100,
      completedAt: body.progress >= 100 ? new Date() : null,
      notes: body.notes,
    },
    update: {
      progress: body.progress,
      completed: body.progress >= 100,
      completedAt: body.progress >= 100 ? new Date() : null,
      notes: body.notes,
      lastViewedAt: new Date(),
    },
  });

  return c.json({ progress: updated });
});
