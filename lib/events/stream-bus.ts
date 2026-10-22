/**
 * In-memory pub/sub for real-time SSE event streaming (#615).
 *
 * When events are published via `publish()`, they are broadcast to active
 * SSE subscribers filtered by tenant, project, issue, and event types.
 * Subscribers are cleaned up automatically on client disconnect.
 */
import { EventEmitter } from "node:events";
import type { AgentContext } from "@/lib/agents/require-agent";
import type { EventFilters } from "@/lib/agent-api/events";

export type StreamEvent = {
  id: string;
  type: string;
  payload: unknown;
  actorAgentId: string | null;
  bugId: string | null;
  projectId?: string | null;
  tenantId: string;
  createdAt: Date | string;
};

export type StreamSubscription = {
  id: string;
  agent: AgentContext;
  filters: EventFilters;
  onEvent: (event: StreamEvent) => void;
};

class EventStreamBus extends EventEmitter {
  private subscriptions = new Map<string, StreamSubscription>();
  private counter = 0;

  /**
   * Subscribe a client to real-time events.
   * @param agent - Authenticated agent context
   * @param filters - Optional filters for event types/projects/issues
   * @param onEvent - Callback invoked when matching events arrive
   * @returns Subscription id for cleanup
   */
  subscribe(
    agent: AgentContext,
    filters: EventFilters,
    onEvent: (event: StreamEvent) => void,
  ): string {
    const id = `sub_${Date.now()}_${this.counter++}_${Math.random().toString(36).slice(2)}`;
    this.subscriptions.set(id, { id, agent, filters, onEvent });
    return id;
  }

  /**
   * Unsubscribe and cleanup a subscription.
   * @param id - Subscription id returned from subscribe()
   */
  unsubscribe(id: string): void {
    this.subscriptions.delete(id);
  }

  /**
   * Broadcast an event to all matching subscribers.
   * @param event - Event to broadcast
   */
  broadcast(event: StreamEvent): void {
    for (const sub of this.subscriptions.values()) {
      // Enforce tenant scoping
      if (sub.agent.tenantId !== event.tenantId) continue;

      // Enforce project scoping if key is project-scoped
      if (sub.agent.projectId && event.projectId && sub.agent.projectId !== event.projectId) {
        continue;
      }
      if (sub.agent.projectId && !event.projectId) {
        // If agent is project-scoped but event has no project, be restrictive
        // but allow if filters don't require specific project
      }

      // Apply filters
      const filters = sub.filters;
      if (filters.projectId && event.projectId && filters.projectId !== event.projectId) {
        continue;
      }
      if (filters.bugId && event.bugId && filters.bugId !== event.bugId) {
        continue;
      }
      if (filters.types?.length || filters.typePrefixes?.length) {
        const typeMatches = filters.types?.includes(event.type) ||
          filters.typePrefixes?.some((prefix) => event.type.startsWith(prefix));
        if (!typeMatches) continue;
      }

      try {
        sub.onEvent(event);
      } catch {
        // Remove broken subscriptions
        this.subscriptions.delete(sub.id);
      }
    }
    this.emit("event", event);
  }

  /**
   * Get number of active subscriptions (for testing/monitoring).
   */
  get subscriptionCount(): number {
    return this.subscriptions.size;
  }

  /**
   * Alias for subscription count.
   */
  get size(): number {
    return this.subscriptions.size;
  }

  /**
   * Clear all subscriptions (for testing).
   */
  clear(): void {
    this.subscriptions.clear();
  }
}

export const eventStreamBus = new EventStreamBus();

/**
 * Create a subscription for SSE streaming with proper filtering.
 * @param agent - Authenticated agent context
 * @param filters - Event filters (types, projectId, bugId)
 * @param onEvent - Callback for matching events
 * @returns Cleanup function
 */
export function createStreamSubscription(
  agent: AgentContext,
  filters: EventFilters,
  onEvent: (event: StreamEvent) => void,
): () => void {
  const id = eventStreamBus.subscribe(agent, filters, onEvent);
  return () => eventStreamBus.unsubscribe(id);
}
