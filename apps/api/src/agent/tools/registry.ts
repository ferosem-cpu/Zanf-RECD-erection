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
