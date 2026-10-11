import { eyedropperTool } from './eyedropper';
import { brushTool, eraserTool, pencilTool } from './paint-tools';
import { ellipseFilledTool, ellipseTool, lineTool, rectFilledTool, rectTool } from './shape-tools';
import type { Tool, ToolId } from './types';

export * from './types';

const TOOLS: Tool[] = [
  pencilTool,
  brushTool,
  eraserTool,
  lineTool,
  rectTool,
  rectFilledTool,
  ellipseTool,
  ellipseFilledTool,
  eyedropperTool,
];

const BY_ID = new Map<ToolId, Tool>(TOOLS.map((t) => [t.id, t]));

export function getTool(id: ToolId): Tool | undefined {
  return BY_ID.get(id);
}

export function registerTool(tool: Tool): void {
  if (!BY_ID.has(tool.id)) TOOLS.push(tool);
  BY_ID.set(tool.id, tool);
}

export function listTools(): readonly Tool[] {
  return TOOLS;
}
