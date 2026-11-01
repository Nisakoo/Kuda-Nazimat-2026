import { TOOL_IDS, type EquipmentState, type ToolId } from './types.ts';

export function isToolId(value: unknown): value is ToolId {
  return typeof value === 'string' && (TOOL_IDS as readonly string[]).includes(value);
}
export function parseEquipmentState(value: unknown): EquipmentState {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || !Object.hasOwn(value, 'tool')) throw new Error('Invalid equipment state');
  const tool = (value as Record<string, unknown>).tool;
  if (tool !== null && !isToolId(tool)) throw new Error('Invalid tool');
  return { tool };
}
