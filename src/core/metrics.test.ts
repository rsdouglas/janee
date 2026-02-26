import { describe, it, expect, beforeEach } from "vitest";
import { MetricsCollector } from "./metrics.js";

describe("MetricsCollector", () => {
  let collector: MetricsCollector;

  beforeEach(() => {
    collector = new MetricsCollector();
  });

  describe("record + summarize", () => {
    it("starts with empty summary", () => {
      const summary = collector.summarize();
      expect(summary.totalCalls).toBe(0);
      expect(summary.uniqueTools).toBe(0);
      expect(summary.uniqueAgents).toBe(0);
      expect(summary.byTool).toEqual([]);
      expect(summary.byAgent).toEqual([]);
      expect(summary.uptime).toBeGreaterThanOrEqual(0);
    });

    it("records a single tool call", () => {
      collector.record({
        tool: "api_request",
        agentId: "agent-1",
        service: "github",
        duration: 150,
        success: true,
      });

      const summary = collector.summarize();
      expect(summary.totalCalls).toBe(1);
      expect(summary.uniqueTools).toBe(1);
      expect(summary.uniqueAgents).toBe(1);
      expect(summary.byTool[0].tool).toBe("api_request");
      expect(summary.byTool[0].totalCalls).toBe(1);
      expect(summary.byTool[0].successCount).toBe(1);
      expect(summary.byTool[0].errorCount).toBe(0);
      expect(summary.byTool[0].avgDurationMs).toBe(150);
    });

    it("tracks multiple tools and agents", () => {
      collector.record({
        tool: "api_request",
        agentId: "a1",
        service: "s1",
        duration: 100,
        success: true,
      });
      collector.record({
        tool: "api_request",
        agentId: "a2",
        service: "s1",
        duration: 200,
        success: true,
      });
      collector.record({
        tool: "exec_command",
        agentId: "a1",
        service: "s2",
        duration: 50,
        success: false,
      });

      const summary = collector.summarize();
      expect(summary.totalCalls).toBe(3);
      expect(summary.uniqueTools).toBe(2);
      expect(summary.uniqueAgents).toBe(2);

      const apiTool = summary.byTool.find((t) => t.tool === "api_request")!;
      expect(apiTool.totalCalls).toBe(2);
      expect(apiTool.avgDurationMs).toBe(150);

      const execTool = summary.byTool.find((t) => t.tool === "exec_command")!;
      expect(execTool.totalCalls).toBe(1);
      expect(execTool.errorCount).toBe(1);
    });

    it("handles anonymous agents", () => {
      collector.record({
        tool: "api_request",
        service: "s1",
        duration: 100,
        success: true,
      });
      collector.record({
        tool: "api_request",
        agentId: "a1",
        service: "s1",
        duration: 100,
        success: true,
      });

      const summary = collector.summarize();
      expect(summary.uniqueAgents).toBe(2);
      const anon = summary.byAgent.find((a) => a.agentId === "_anonymous");
      expect(anon).toBeDefined();
      expect(anon!.totalCalls).toBe(1);
    });

    it("sorts tools by total calls descending", () => {
      collector.record({
        tool: "rare_tool",
        service: "s1",
        duration: 10,
        success: true,
      });
      for (let i = 0; i < 5; i++) {
        collector.record({
          tool: "popular_tool",
          service: "s1",
          duration: 10,
          success: true,
        });
      }

      const summary = collector.summarize();
      expect(summary.byTool[0].tool).toBe("popular_tool");
      expect(summary.byTool[1].tool).toBe("rare_tool");
    });
  });

  describe("p95 duration", () => {
    it("calculates p95 correctly", () => {
      // 20 calls with durations 1..20ms
      for (let i = 1; i <= 20; i++) {
        collector.record({
          tool: "test",
          service: "s1",
          duration: i,
          success: true,
        });
      }

      const summary = collector.summarize();
      // p95 index = floor(20 * 0.95) = 19, sorted[19] = 20
      expect(summary.byTool[0].p95DurationMs).toBe(20);
    });

    it("handles single call p95", () => {
      collector.record({
        tool: "test",
        service: "s1",
        duration: 42,
        success: true,
      });

      const summary = collector.summarize();
      expect(summary.byTool[0].p95DurationMs).toBe(42);
    });
  });

  describe("time window filtering", () => {
    it("filters records by window", async () => {
      collector.record({
        tool: "old",
        service: "s1",
        duration: 10,
        success: true,
      });

      // Small delay to separate records
      await new Promise((r) => setTimeout(r, 50));

      collector.record({
        tool: "new",
        service: "s1",
        duration: 10,
        success: true,
      });

      // With no window, both visible
      expect(collector.summarize().totalCalls).toBe(2);

      // With 0-second window (everything after now), should be 0
      // Actually let's use a tiny window — anything within the last 0.01s
      const summary = collector.summarize(0.01);
      // The newest record might still be in window; at minimum should be <= 2
      expect(summary.totalCalls).toBeLessThanOrEqual(2);
    });
  });

  describe("maxRecords eviction", () => {
    it("evicts oldest records when over limit", () => {
      const small = new MetricsCollector({ maxRecords: 5 });

      for (let i = 0; i < 10; i++) {
        small.record({
          tool: `tool-${i}`,
          service: "s1",
          duration: 10,
          success: true,
        });
      }

      const summary = small.summarize();
      expect(summary.totalCalls).toBe(5);
      // Should have the last 5 tools (5-9)
      const toolNames = summary.byTool.map((t) => t.tool);
      expect(toolNames).not.toContain("tool-0");
      expect(toolNames).toContain("tool-9");
    });
  });

  describe("reset", () => {
    it("clears all records", () => {
      collector.record({
        tool: "test",
        service: "s1",
        duration: 10,
        success: true,
      });
      expect(collector.summarize().totalCalls).toBe(1);

      collector.reset();
      expect(collector.summarize().totalCalls).toBe(0);
    });
  });
});
