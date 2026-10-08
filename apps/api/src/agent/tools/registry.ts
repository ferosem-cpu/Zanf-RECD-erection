import type { AgentTool } from "./types";
import { driveTools } from "./driveTool";
import { zanAppReadTools } from "./zanAppReadTools";
import { zanAppFinanceTools } from "./zanAppFinanceTools";
import { getDocumentDetailTool } from "./zanAppDetailTool";
import { zanAppWriteTools } from "./zanAppWriteTools";

export const allTools: AgentTool[] = [
  ...driveTools,
  ...zanAppReadTools,
  ...zanAppFinanceTools,
  getDocumentDetailTool,
  ...zanAppWriteTools,
];

export function getToolByName(name: string): AgentTool | undefined {
  return allTools.find((t) => t.name === name);
}

const WRITE_TOOL_NAMES = new Set(zanAppWriteTools.map((t) => t.name));

/** Confirm-gated write tools (create_*): never run concurrently or under a tool timeout. */
export function isWriteTool(name: string): boolean {
  return WRITE_TOOL_NAMES.has(name);
}
