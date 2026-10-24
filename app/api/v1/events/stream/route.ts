import { NextResponse, type NextRequest } from "next/server";
import { parseEventFilters, parseEventCursor } from "@/lib/agent-api/events";
import { eventStreamBus, type StreamEvent } from "@/lib/events/stream-bus";
import { agentErrorResponse, requireAgent, type AgentContext } from "@/lib/agents/require-agent";
import { requireLevel } from "@/lib/agents/levels";
import { consumeAgentBudget, agentBudgetExceededResponse } from "@/lib/agents/rate-budget";
import { withAgentBudgetHeaders } from "@/lib/agents/rate-budget-headers";
import { audit } from "@/lib/agents/audit";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * GET /api/v1/events/stream?types=&projectId=&bugId=&after=&afterId=
 *
 * Server-Sent Events stream endpoint for real-time agent events (#615).
 * Subscribes to in-memory event bus and sends events as they occur.
 *
 * Streaming headers:
 * - Content-Type: text/event-stream
 * - Cache-Control: no-cache, no-transform
 * - Connection: keep-alive
 *
 * Heartbeat: sends periodic ping comments `: ping\n\n` to keep connections alive.
 * Event format: `id: <id>\nevent: <type>\ndata: <json>\n\n`
 *
 * Client disconnection is handled via request.signal.abort to clean up subscriptions.
 *
 * Query parameters:
 * - `types`     — comma list of event types or prefixes (`claim.*`)
 * - `projectId` — filter by project
 * - `bugId`     — filter by issue
 * - `after`     — resume from cursor (optional, for replaying missed events)
 * - `afterId`   — tie-breaker when `after` is timestamp
 *
 * Requires authenticated agent key. Respects tenant scoping and project restrictions.
 */
export async function GET(request: NextRequest) {
  let agent: AgentContext;
  try {
    agent = await requireAgent(request);
    requireLevel(agent, "observer");
  } catch (error) {
    return agentErrorResponse(error);
  }

  const budget = await consumeAgentBudget({ id: agent.agentId, burst: agent.burst }, "read");
  if (!budget.allowed) {
    const res = agentBudgetExceededResponse(budget.retryAfterSeconds, budget);
    return res;
  }

  const params = request.nextUrl.searchParams;

  const filters = parseEventFilters(params);
  if ("error" in filters) {
    return NextResponse.json(filters, { status: 400 });
  }

  const cursorResult = parseEventCursor(params);
  if (cursorResult === "invalid") {
    return NextResponse.json({ error: "Invalid cursor." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  let heartbeatInterval: NodeJS.Timeout | null = null;
  let subscriptionId: string | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const connectMsg = `event: connected\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`;
      controller.enqueue(encoder.encode(connectMsg));

      heartbeatInterval = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch (err) {
          cleanup();
          controller.error(err);
        }
      }, 15000);

      if (cursorResult) {
        replayMissedEvents(agent, cursorResult, filters)
          .then((events) => {
            if (closed || !events) return;
            for (const event of events) {
              const sseLine = formatSseEvent({
                id: event.id,
                type: event.type,
                payload: event.payload,
                actorAgentId: event.actorAgentId,
                bugId: event.bugId,
                tenantId: agent.tenantId,
                createdAt: event.createdAt,
              });
              try {
                controller.enqueue(encoder.encode(sseLine));
              } catch {
                break;
              }
            }
          })
          .catch(() => {});
      }

      subscriptionId = eventStreamBus.subscribe(agent, filters, (event: StreamEvent) => {
        if (closed) return;
        try {
          const sseLine = formatSseEvent(event);
          controller.enqueue(encoder.encode(sseLine));
        } catch (err) {
          cleanup();
          controller.error(err);
        }
      });

      request.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      cleanup();
    },
  });

  function cleanup() {
    closed = true;
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    if (subscriptionId) {
      eventStreamBus.unsubscribe(subscriptionId);
      subscriptionId = null;
    }
  }

  const payload = { status: 200, request: true as const };
  try {
    await audit(agent, "events.stream", null, payload);
  } catch (error) {
    logger.error("[agent-api] request audit failed", {
      tenantId: agent.tenantId,
      agentId: agent.agentId,
      action: "events.stream",
      target: null,
      payload,
    }, error);
  }

  const response = new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
  response.headers.set("Cache-Control", "no-cache, no-transform");
  return withAgentBudgetHeaders(response, budget) as unknown as NextResponse;
}

/**
 * Format an event as SSE frame.
 * @param event - Event to format
 * @returns Formatted SSE string: `id: <id>\nevent: <type>\ndata: <json>\n\n`
 */
function formatSseEvent(event: StreamEvent): string {
  const data = JSON.stringify({
    id: event.id,
    type: event.type,
    payload: event.payload,
    actorAgentId: event.actorAgentId,
    bugId: event.bugId,
    createdAt: event.createdAt instanceof Date ? event.createdAt.toISOString() : event.createdAt,
  });
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${data}\n\n`;
}

/**
 * Replay missed events from database after cursor position.
 * @param agent - Agent context
 * @param cursor - Event cursor
 * @param filters - Event filters
 * @returns Array of events or null
 */
async function replayMissedEvents(
  agent: { tenantId: string },
  cursor: import("@/lib/agent-api/events").EventCursor | null,
  filters: import("@/lib/agent-api/events").EventFilters,
) {
  try {
    const { listEvents } = await import("@/lib/agent-api/events");
    const events = await listEvents(agent, cursor, filters);
    return events;
  } catch {
    return null;
  }
}
