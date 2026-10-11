import { eyedropperTool } from './eyedropper';
import { bucketTool, ellipseSelectTool, lassoTool, magicWandTool, moveTool, rectSelectTool } from './fill-select-tools';
import { blurTool, brushTool, contourTool, curveTool, eraserTool, jumbleTool, pencilTool, sprayTool } from './paint-tools';
import { ellipseFilledTool, ellipseTool, lineTool, rectFilledTool, rectTool } from './shape-tools';
import { gradientTool, textTool } from './text-gradient-tools';
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
  bucketTool,
  rectSelectTool,
  ellipseSelectTool,
  lassoTool,
  magicWandTool,
  moveTool,
  textTool,
  gradientTool,
  sprayTool,
  contourTool,
  curveTool,
  blurTool,
  jumbleTool,
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
