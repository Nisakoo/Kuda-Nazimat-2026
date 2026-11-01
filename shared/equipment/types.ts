export const TOOL_IDS = ['bag', 'jug'] as const;
export type ToolId = typeof TOOL_IDS[number];
export interface EquipmentState { readonly tool: ToolId | null }
