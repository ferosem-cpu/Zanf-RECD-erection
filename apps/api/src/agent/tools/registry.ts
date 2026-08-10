import type { AgentTool } from "./types";
import { driveTools } from "./driveTool";
import { zanAppReadTools } from "./zanAppReadTools";
import { getDocumentDetailTool } from "./zanAppDetailTool";

// Grows as more tool sets are built: zanAppWriteTools (confirm-gated creates), etc.
export const allTools: AgentTool[] = [...driveTools, ...zanAppReadTools, getDocumentDetailTool];

export function getToolByName(name: string): AgentTool | undefined {
  return allTools.find((t) => t.name === name);
}
