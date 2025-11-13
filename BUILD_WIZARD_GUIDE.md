# Arty Build Wizard Guide

## Quick Start

### Interactive Mode
Run the wizard interactively to see all options:
```bash
bun run wizard
```

### Direct Commands (CLI Flags)

Run commands directly without the interactive menu:

1. **EAS Build Dev**
   ```bash
   bun run wizard eas-build-dev
   ```
   Runs: `eas build --platform ios --profile dev_self_contained --non-interactive`

2. **EAS Build Dev Local**
   ```bash
   bun run wizard eas-build-dev-local
   ```
   Runs: `eas build --platform ios --profile dev_self_contained --non-interactive --local`

3. **EAS Update Dev**
   ```bash
   bun run wizard eas-update-dev
   ```
   Runs: `eas update --platform ios --branch dev_self_contained --message "Update"`

4. **Clean Build**
   ```bash
   bun run wizard clean-build
   ```
   Runs: `CI=1 bunx expo prebuild --clean --platform ios`

5. **EAS Build Production**
   ```bash
   bun run wizard eas-build-prod
   ```
   Runs: `eas build --platform ios --profile production --non-interactive && eas submit --platform ios`

## MCP Server for Claude Code

An MCP server has been created to allow Claude Code to execute these build commands.

### Setup Instructions

1. **Install MCP server dependencies** (if not already done):
   ```bash
   cd mcp-server
   bun install
   ```

2. **Configure Claude Code:**

   Edit your Claude Code configuration file:
   - macOS/Linux: `~/.claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`

   Add this configuration (replace `/home/tleyden/arty` with your actual project path):

   ```json
   {
     "mcpServers": {
       "arty-build-eas": {
         "command": "bun",
         "args": ["run", "/home/tleyden/arty/mcp-server/index.ts"],
         "cwd": "/home/tleyden/arty"
       }
     }
   }
   ```

3. **Restart Claude Code**

4. **Test the integration:**
   Ask Claude Code: "Use the arty-build-eas-tool to build dev"

### MCP Tool Usage

The MCP server provides a single tool: `arty-build-eas-tool`

**Parameters:**
- `action`: One of the following:
  - `eas-build-dev`
  - `eas-build-dev-local`
  - `eas-update-dev`
  - `clean-build`
  - `eas-build-prod`

**Example prompts for Claude Code:**
- "Build the dev version using arty-build-eas-tool"
- "Push an OTA update using the arty tool"
- "Run a clean build"
- "Build and submit to production"

## Files Created

- `/wizard.ts` - Main wizard script
- `/mcp-server/index.ts` - MCP server implementation
- `/mcp-server/package.json` - MCP server dependencies
- `/mcp-server/README.md` - Detailed MCP server documentation
- `/BUILD_WIZARD_GUIDE.md` - This guide

## Notes

- The wizard script uses Bun's native capabilities for execution
- All commands run in the project root directory
- Exit codes are properly propagated
- Both stdout and stderr are displayed during command execution
- The MCP server can be used from any MCP-compatible client, not just Claude Code
