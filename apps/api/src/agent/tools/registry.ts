import type { AgentTool } from "./types";
import { driveTools } from "./driveTool";

// Grows as more tool sets are built: zanAppReadTools (customers/invoices/work orders),
// zanAppWriteTools (confirm-gated creates/updates), etc.
export const allTools: AgentTool[] = [...driveTools];

export function getToolByName(name: string): AgentTool | undefined {
  return allTools.find((t) => t.name === name);
}
