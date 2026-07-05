/// <reference types="@cloudflare/workers-types" />
import { verifyJwt } from "../common/jwt";
import type { Env } from "../prisma/prisma.edge";

// RealtimeHub — a single global Durable Object that fans out live events to
// connected browser clients over WebSocket, replacing the REST-polling used
// since Fase 2. Uses the WebSocket Hibernation API (state.acceptWebSocket)
// so idle connections don't keep the DO's isolate pinned in memory between
// messages — required for this to stay affordable with thousands of
// concurrently-open-but-quiet trading dashboards.
//
// Two entry points into fetch():
//   - GET with `Upgrade: websocket` — a browser client connecting, JWT
//     passed as `?token=`. The accepted socket is tagged `user:<userId>` so
//     later broadcasts can target one user's connections specifically.
//   - POST /broadcast — internal-only, called by other Worker routes (via
//     the REALTIME_HUB binding, never reachable from the public Internet)
//     to push `{type, payload, userId?}`; omitting userId broadcasts to
//     every connected client (used for market.quotes).
export class RealtimeHub {
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/broadcast") {
      const body = await request.json<{ type: string; payload: unknown; userId?: string }>();
      const frame = JSON.stringify({ type: body.type, payload: body.payload ?? null });

      const targets = body.userId ? this.state.getWebSockets(`user:${body.userId}`) : this.state.getWebSockets();
      for (const ws of targets) {
        try {
          ws.send(frame);
        } catch {
          // Socket already gone — hibernation cleanup will drop it.
        }
      }
      return new Response(JSON.stringify({ ok: true, delivered: targets.length }), { headers: { "content-type": "application/json" } });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade or POST /broadcast", { status: 400 });
    }

    const token = url.searchParams.get("token");
    let userId: string;
    try {
      if (!token) throw new Error("missing token");
      const payload = await verifyJwt(token, this.env.JWT_SECRET);
      userId = payload.sub;
    } catch {
      // Match the frontend's expected close code for "JWT rejected" so it
      // attempts a silent cookie-based refresh before giving up (see
      // igfxpro-frontend/api/websocket.ts's onclose handler).
      const pair = new WebSocketPair();
      pair[1].accept();
      pair[1].close(4001, "invalid or expired token");
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    this.state.acceptWebSocket(server, [`user:${userId}`]);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;
    try {
      const msg = JSON.parse(message) as { type?: string };
      if (msg.type === "ping") ws.send(JSON.stringify({ type: "pong", payload: {} }));
    } catch {
      // ignore malformed client frames
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      // already closed
    }
  }

  async webSocketError(): Promise<void> {
    // Hibernation API drops the socket from getWebSockets() automatically
    // once it errors — nothing to clean up manually here.
  }
}
