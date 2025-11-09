import toolkitGroupsData from '../toolkits/toolkitGroups.json';

import type { ToolkitDefinition, ToolkitGroup, ToolkitGroups } from './VmWebrtc.types';

const buildToolkitGroups = (): ToolkitGroups => {
  const byName = (toolkitGroupsData.byName ?? {}) as Record<string, ToolkitGroup>;
  const list = Array.isArray(toolkitGroupsData.list)
    ? (toolkitGroupsData.list as ToolkitGroup[])
    : Object.values(byName);

  return {
    byName,
    list,
  };
};

const toolkitGroups = buildToolkitGroups();

export const getToolkitGroups = (): ToolkitGroups => toolkitGroups;

export const getToolkitDefinitions = (): ToolkitDefinition[] => {
  return toolkitGroups.list.flatMap((group) => group.toolkits);
};
