# Arty Build EAS MCP Server

This MCP server provides a single tool to execute Arty EAS build and deployment commands through Claude Code or any MCP-compatible client.

## Tool Available

### `arty-build-eas-tool`

Executes Arty EAS build and deployment commands.

**Parameters:**
- `action` (required): The build action to execute

**Available Actions:**
- `eas-build-dev`: Build iOS app with dev_self_contained profile
- `eas-build-dev-local`: Build iOS app locally with dev_self_contained profile
- `eas-update-dev`: Push an OTA update to dev_self_contained branch
- `clean-build`: Clean prebuild for iOS
- `eas-build-prod`: Build and submit iOS app to App Store

## Installation

The dependencies are already installed if you ran `bun install` in the `mcp-server` directory.

If not, run:

```bash
cd mcp-server
bun install
```

## Configuration for Claude Code

To use this MCP server with Claude Code, you need to add it to your Claude Code configuration file.

### Step 1: Locate your Claude Code config file

The configuration file is located at:
- macOS/Linux: `~/.claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

### Step 2: Add the MCP server configuration

Add the following to the `mcpServers` section of your config file:

```json
{
  "mcpServers": {
    "arty-build-eas": {
      "command": "bun",
      "args": ["run", "/ABSOLUTE/PATH/TO/arty/mcp-server/index.ts"],
      "cwd": "/ABSOLUTE/PATH/TO/arty"
    }
  }
}
```

**Important:** Replace `/ABSOLUTE/PATH/TO/arty` with the actual absolute path to your arty project directory.

For example, if your project is at `/home/tleyden/arty`, the configuration would be:

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

### Step 3: Restart Claude Code

After updating the configuration, restart Claude Code for the changes to take effect.

### Step 4: Verify the tool is available

In Claude Code, you can ask:
- "What tools are available?"
- "Can you use the arty-build-eas-tool?"

You should see `arty-build-eas-tool` listed among the available tools.

## Usage Examples

Once configured, you can ask Claude Code to use the tool:

1. **Build for dev:**
   ```
   Use the arty-build-eas-tool with action "eas-build-dev"
   ```

2. **Build locally:**
   ```
   Use the arty-build-eas-tool to build dev locally
   ```

3. **Push an update:**
   ```
   Push an OTA update using arty-build-eas-tool
   ```

4. **Clean build:**
   ```
   Run a clean build using the arty tool
   ```

5. **Production build and submit:**
   ```
   Build and submit to the App Store using arty-build-eas-tool
   ```

Claude Code will automatically map your request to the appropriate action parameter.

## Full Configuration Example

Here's a complete example of what your `claude_desktop_config.json` might look like:

```json
{
  "mcpServers": {
    "arty-build-eas": {
      "command": "bun",
      "args": ["run", "/home/tleyden/arty/mcp-server/index.ts"],
      "cwd": "/home/tleyden/arty"
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/tleyden"]
    }
  }
}
```

## Troubleshooting

### Server not starting

1. Make sure `bun` is installed and in your PATH
2. Verify the paths in the configuration are absolute paths
3. Check that dependencies are installed: `cd mcp-server && bun install`
4. Look at Claude Code logs for error messages

### Tool not appearing

1. Restart Claude Code completely
2. Verify the JSON configuration is valid (no syntax errors)
3. Check that the `mcpServers` key exists in your config file

### Command fails to execute

1. The MCP server runs commands from the `cwd` specified in the config
2. Make sure `eas` CLI is installed and accessible
3. Check that you're logged into EAS: `eas login`
4. Verify you have the necessary permissions for the project
