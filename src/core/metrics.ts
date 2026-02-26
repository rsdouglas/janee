/**
 * Tool call metrics for Janee
 * Tracks per-tool and per-agent usage statistics in-memory.
 * Metrics reset on process restart (by design — they track runtime behavior).
 */

export interface ToolCallRecord {
  tool: string;
  agentId?: string;
  service: string;
  duration: number; // ms
  success: boolean;
  timestamp: number; // Date.now()
}

export interface ToolMetrics {
  tool: string;
  totalCalls: number;
  successCount: number;
  errorCount: number;
  avgDurationMs: number;
  p95DurationMs: number;
  lastCalledAt: string;
}

export interface AgentMetrics {
  agentId: string;
  totalCalls: number;
  uniqueTools: number;
  lastActiveAt: string;
}

export interface MetricsSummary {
  uptime: number; // seconds
  totalCalls: number;
  uniqueTools: number;
  uniqueAgents: number;
  byTool: ToolMetrics[];
  byAgent: AgentMetrics[];
}

export class MetricsCollector {
  private records: ToolCallRecord[] = [];
  private readonly startTime = Date.now();
  private readonly maxRecords: number;

  constructor(options: { maxRecords?: number } = {}) {
    // Keep last N records in memory to bound growth. Default 10k.
    this.maxRecords = options.maxRecords ?? 10_000;
  }

  /**
   * Record a tool call.
   */
  record(entry: Omit<ToolCallRecord, "timestamp">): void {
    this.records.push({ ...entry, timestamp: Date.now() });

    // Evict oldest records if over limit
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(-this.maxRecords);
    }
  }

  /**
   * Get a full metrics summary.
   * Optionally filter by time window (last N seconds).
   */
  summarize(windowSeconds?: number): MetricsSummary {
    const cutoff = windowSeconds ? Date.now() - windowSeconds * 1000 : 0;

    const filtered =
      cutoff > 0
        ? this.records.filter((r) => r.timestamp >= cutoff)
        : this.records;

    const byTool = this.aggregateByTool(filtered);
    const byAgent = this.aggregateByAgent(filtered);

    return {
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      totalCalls: filtered.length,
      uniqueTools: byTool.length,
      uniqueAgents: byAgent.length,
      byTool,
      byAgent,
    };
  }

  /**
   * Reset all recorded metrics.
   */
  reset(): void {
    this.records = [];
  }

  private aggregateByTool(records: ToolCallRecord[]): ToolMetrics[] {
    const groups = new Map<string, ToolCallRecord[]>();
    for (const r of records) {
      const existing = groups.get(r.tool);
      if (existing) {
        existing.push(r);
      } else {
        groups.set(r.tool, [r]);
      }
    }

    const result: ToolMetrics[] = [];
    for (const [tool, recs] of groups) {
      const durations = recs.map((r) => r.duration).sort((a, b) => a - b);
      const successCount = recs.filter((r) => r.success).length;
      const p95Index = Math.min(
        Math.floor(durations.length * 0.95),
        durations.length - 1,
      );

      result.push({
        tool,
        totalCalls: recs.length,
        successCount,
        errorCount: recs.length - successCount,
        avgDurationMs: Math.round(
          durations.reduce((a, b) => a + b, 0) / durations.length,
        ),
        p95DurationMs: durations[p95Index],
        lastCalledAt: new Date(
          Math.max(...recs.map((r) => r.timestamp)),
        ).toISOString(),
      });
    }

    // Sort by total calls descending
    return result.sort((a, b) => b.totalCalls - a.totalCalls);
  }

  private aggregateByAgent(records: ToolCallRecord[]): AgentMetrics[] {
    const groups = new Map<string, ToolCallRecord[]>();
    for (const r of records) {
      const id = r.agentId || "_anonymous";
      const existing = groups.get(id);
      if (existing) {
        existing.push(r);
      } else {
        groups.set(id, [r]);
      }
    }

    const result: AgentMetrics[] = [];
    for (const [agentId, recs] of groups) {
      const uniqueTools = new Set(recs.map((r) => r.tool)).size;
      result.push({
        agentId,
        totalCalls: recs.length,
        uniqueTools,
        lastActiveAt: new Date(
          Math.max(...recs.map((r) => r.timestamp)),
        ).toISOString(),
      });
    }

    return result.sort((a, b) => b.totalCalls - a.totalCalls);
  }
}
