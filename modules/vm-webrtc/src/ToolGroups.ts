import { gdriveConnectorDefinition, gdriveListFoldersDefinition } from './ToolGDriveConnector';
import { githubConnectorDefinition, githubListOrganizationsDefinition } from './ToolGithubConnector';
import { gpt5GDriveFixerDefinition } from './ToolGPT5GDriveFixer';
import { gpt5WebSearchDefinition } from './ToolGPT5WebSearch';
import type { ToolDefinition } from './VmWebrtc.types';

export type ToolGroup = {
  id: string;
  label: string;
  definitions: ToolDefinition[];
};

export const githubToolGroup: ToolGroup = {
  id: 'github',
  label: 'GitHub tool suite',
  definitions: [githubConnectorDefinition, githubListOrganizationsDefinition],
};

export const gdriveToolGroup: ToolGroup = {
  id: 'gdrive',
  label: 'Google Drive tool suite',
  definitions: [gdriveConnectorDefinition, gdriveListFoldersDefinition],
};

export const connectorToolGroups: ToolGroup[] = [githubToolGroup, gdriveToolGroup];

export const singleToolGroups: ToolGroup[] = [
  {
    id: 'gpt5_gdrive_fixer',
    label: 'GPT-5 Google Drive fixer',
    definitions: [gpt5GDriveFixerDefinition],
  },
  {
    id: 'gpt5_web_search',
    label: 'GPT-5 Web Search',
    definitions: [gpt5WebSearchDefinition],
  },
];

export const allToolGroups: ToolGroup[] = [...connectorToolGroups, ...singleToolGroups];

export const defaultToolDefinitions: ToolDefinition[] = allToolGroups.flatMap((group) => group.definitions);
