import type { Env } from "../prisma/prisma.edge";

// Thin client for the RealtimeHub Durable Object (Fase 9) — every route
// module that needs to push a live event calls one of these instead of
// touching the DO binding directly. Failures are swallowed: a dropped push
// must never fail the HTTP request that triggered it (the frontend still
// works via its existing REST fetch-on-ws.connected fallback).
function hub(env: Env) {
  return env.REALTIME_HUB.get(env.REALTIME_HUB.idFromName("global"));
}

async function broadcast(env: Env, body: { type: string; payload: unknown; userId?: string }): Promise<void> {
  try {
    await hub(env).fetch("https://internal/broadcast", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error(`[realtime] push failed for type=${body.type}`, err);
  }
}

export function pushToUser(env: Env, userId: string, type: string, payload: unknown): Promise<void> {
  return broadcast(env, { type, payload, userId });
}

export function broadcastAll(env: Env, type: string, payload: unknown): Promise<void> {
  return broadcast(env, { type, payload });
}
