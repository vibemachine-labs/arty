import toolkitGroupsData from '../toolkits/toolkitGroups.json';

import type { ToolDefinition, ToolkitDefinition, ToolkitGroup, ToolkitGroups } from './VmWebrtc.types';
import { exportToolDefinition } from './VmWebrtc.types';

const buildToolkitGroups = (): ToolkitGroups => {
  const data = toolkitGroupsData as unknown as ToolkitGroups;
  const byName = data.byName ?? {};
  const list = Array.isArray(data.list) ? data.list : Object.values(byName);

  return {
    byName,
    list,
  };
};

const toolkitGroups = buildToolkitGroups();

export const getToolkitGroups = (): ToolkitGroups => toolkitGroups;

/**
 * Gets all toolkit definitions and converts them to tool definitions with
 * fully qualified names (group:name format, e.g., "hacker_news:showTopStories").
 */
export const getToolkitDefinitions = (): ToolDefinition[] => {
  return toolkitGroups.list.flatMap((group) =>
    group.toolkits.map((toolkit) => exportToolDefinition(toolkit, true))
  );
};

/**
 * Gets raw toolkit definitions without conversion (for internal use).
 */
export const getRawToolkitDefinitions = (): ToolkitDefinition[] => {
  return toolkitGroups.list.flatMap((group) => group.toolkits);
};
