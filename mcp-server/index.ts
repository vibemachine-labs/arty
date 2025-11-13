#!/usr/bin/env bun

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { spawn } from "bun";

interface BuildAction {
  action: string;
  command: string;
  description: string;
}

const BUILD_ACTIONS: BuildAction[] = [
  {
    action: "eas-build-dev",
    command: "eas build --platform ios --profile dev_self_contained --non-interactive",
    description: "Build iOS app with dev_self_contained profile",
  },
  {
    action: "eas-build-dev-local",
    command: "eas build --platform ios --profile dev_self_contained --non-interactive --local",
    description: "Build iOS app locally with dev_self_contained profile",
  },
  {
    action: "eas-update-dev",
    command: 'eas update --platform ios --branch dev_self_contained --message "Update"',
    description: "Push an OTA update to dev_self_contained branch",
  },
  {
    action: "clean-build",
    command: "CI=1 bunx expo prebuild --clean --platform ios",
    description: "Clean prebuild for iOS",
  },
  {
    action: "eas-build-prod",
    command: "eas build --platform ios --profile production --non-interactive && eas submit --platform ios",
    description: "Build and submit iOS app to App Store",
  },
];

async function executeCommand(command: string): Promise<{ output: string; exitCode: number }> {
  const proc = spawn({
    cmd: ["sh", "-c", command],
    stdout: "pipe",
    stderr: "pipe",
  });

  const output = await new Response(proc.stdout).text();
  const error = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  const combinedOutput = output + (error ? `\nSTDERR:\n${error}` : "");

  return {
    output: combinedOutput || "Command completed with no output",
    exitCode,
  };
}

const server = new Server(
  {
    name: "arty-build-eas-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const actionDescriptions = BUILD_ACTIONS.map(
    (a) => `- ${a.action}: ${a.description}`
  ).join("\n");

  return {
    tools: [
      {
        name: "arty-build-eas-tool",
        description: `Execute Arty EAS build and deployment commands. Available actions:\n${actionDescriptions}`,
        inputSchema: {
          type: "object",
          properties: {
            action: {
              type: "string",
              description: "The build action to execute",
              enum: BUILD_ACTIONS.map((a) => a.action),
            },
          },
          required: ["action"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "arty-build-eas-tool") {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const action = request.params.arguments?.action as string;

  if (!action) {
    throw new Error("Missing required parameter: action");
  }

  const buildAction = BUILD_ACTIONS.find((a) => a.action === action);

  if (!buildAction) {
    throw new Error(
      `Unknown action: ${action}. Valid actions: ${BUILD_ACTIONS.map((a) => a.action).join(", ")}`
    );
  }

  const { output, exitCode } = await executeCommand(buildAction.command);

  return {
    content: [
      {
        type: "text",
        text: `Action: ${buildAction.action}\nCommand: ${buildAction.command}\n\nExit Code: ${exitCode}\n\nOutput:\n${output}`,
      },
    ],
  };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Arty Build EAS MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
