import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { getPrisma } from "../../prisma/prisma.edge";
import { jwtAuthMiddleware } from "../../common/middleware/jwt-auth.middleware";
import { rolesMiddleware } from "../../common/middleware/roles.middleware";
import { BadRequestException, NotFoundException } from "../../common/http-exceptions";
import type { HonoEnv } from "../../common/types";

// Ported from apiv2's support-service/support.service.ts — real DB-backed
// (prisma.supportTicket), portable as-is. eventBus notifications (fire-and-
// forget WS pushes to admins) are dropped, matching every other module's
// deferral of real-time fan-out to the Fase 9 Durable Object project.

export const supportRoutes = new Hono<HonoEnv>();
supportRoutes.use("*", jwtAuthMiddleware);

const SLA_HOURS: Record<string, number> = { URGENT: 2, HIGH: 8, NORMAL: 24, LOW: 72 };

supportRoutes.get("/tickets", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);
  const status = c.req.query("status");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "20"), 100);
  const offset = parseInt(c.req.query("offset") ?? "0");

  const where: Record<string, unknown> = { userId: user.sub };
  if (status) where.status = status;

  const [tickets, total] = await Promise.all([
    prisma.supportTicket.findMany({ where, orderBy: { createdAt: "desc" }, take: limit, skip: offset }),
    prisma.supportTicket.count({ where }),
  ]);

  return c.json({ tickets, total });
});

supportRoutes.post("/tickets", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);
  const body = await c.req.json<{ subject?: string; message?: string; priority?: string; category?: string }>();
  if (!body.subject || !body.message) throw new BadRequestException("subject and message are required");

  const priority = body.priority ?? "NORMAL";
  const category = body.category ?? "GENERAL";
  const slaDeadline = new Date(Date.now() + (SLA_HOURS[priority] ?? SLA_HOURS.NORMAL) * 3_600_000);

  const ticket = await prisma.supportTicket.create({
    data: {
      userId: user.sub,
      subject: body.subject.slice(0, 200),
      message: body.message.slice(0, 5000),
      status: "OPEN",
      priority,
      category,
      slaDeadline,
    },
  });

  await prisma.auditLog.create({
    data: { id: randomUUID(), actor: user.sub, action: "support.ticket.created", entity: `ticket:${ticket.id}`, payload: { subject: ticket.subject, priority, category } },
  });

  return c.json({ ticket });
});

supportRoutes.get("/tickets/:id", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);
  const ticket = await prisma.supportTicket.findFirst({ where: { id: c.req.param("id"), userId: user.sub } });
  if (!ticket) throw new NotFoundException("Ticket not found");
  return c.json({ ticket });
});

// ── Admin/agent workflow ─────────────────────────────────────────────────────

export const supportAdminRoutes = new Hono<HonoEnv>();
supportAdminRoutes.use("*", jwtAuthMiddleware, rolesMiddleware("admin", "super_admin"));

supportAdminRoutes.get("/tickets", async (c) => {
  const prisma = getPrisma(c.env);
  const status = c.req.query("status");
  const priority = c.req.query("priority");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50"), 200);
  const offset = parseInt(c.req.query("offset") ?? "0");

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (priority) where.priority = priority;

  const [tickets, total] = await Promise.all([
    prisma.supportTicket.findMany({
      where,
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      take: limit,
      skip: offset,
      include: { User: { select: { email: true, fullName: true } } },
    }),
    prisma.supportTicket.count({ where }),
  ]);

  return c.json({ tickets, total });
});

supportAdminRoutes.post("/tickets/:id/reply", async (c) => {
  const admin = c.get("user")!;
  const prisma = getPrisma(c.env);
  const body = await c.req.json<{ agentNote?: string }>();
  if (!body.agentNote) throw new BadRequestException("agentNote is required");

  const existing = await prisma.supportTicket.findUnique({ where: { id: c.req.param("id") } });
  if (!existing) throw new NotFoundException("Ticket not found");

  const ticket = await prisma.supportTicket.update({
    where: { id: existing.id },
    data: { agentNote: body.agentNote, status: existing.status === "OPEN" ? "IN_PROGRESS" : existing.status },
  });

  await prisma.auditLog.create({
    data: { id: randomUUID(), actor: admin.sub, action: "support.ticket.replied", entity: `ticket:${ticket.id}`, payload: { agentNote: body.agentNote } },
  });

  return c.json({ ticket });
});

supportAdminRoutes.put("/tickets/:id/status", async (c) => {
  const admin = c.get("user")!;
  const prisma = getPrisma(c.env);
  const body = await c.req.json<{ status?: string; resolution?: string }>();
  if (!body.status) throw new BadRequestException("status is required");

  const existing = await prisma.supportTicket.findUnique({ where: { id: c.req.param("id") } });
  if (!existing) throw new NotFoundException("Ticket not found");

  const isResolved = body.status === "RESOLVED" || body.status === "CLOSED";
  const ticket = await prisma.supportTicket.update({
    where: { id: existing.id },
    data: {
      status: body.status,
      ...(body.resolution ? { resolution: body.resolution } : {}),
      ...(isResolved ? { resolvedAt: new Date() } : {}),
    },
  });

  await prisma.auditLog.create({
    data: { id: randomUUID(), actor: admin.sub, action: `support.ticket.${body.status.toLowerCase()}`, entity: `ticket:${ticket.id}`, payload: { status: body.status, resolution: body.resolution ?? null } },
  });

  return c.json({ ticket });
});
