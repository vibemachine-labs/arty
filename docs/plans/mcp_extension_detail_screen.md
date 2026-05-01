# MCP Extension Detail Screen Plan

## Goal

Tapping a saved MCP extension in `McpExtensionsScreen` navigates to a detail screen showing
the extension's metadata, its live tools list, and action buttons (Configure, Remove).

---

## Current State

- `McpExtensionsScreen` renders a flat list of `McpExtensionRecord` cards with only a delete
  button per row.
- Navigation is modal-state-based (no React Navigation stack).
- `MCPClient` in `modules/vm-webrtc/src/mcp_client/client.ts` can already call `tools/list`.
- `McpConnectorConfig` is the existing "add / edit" form modal.

---

## Navigation Approach

Since the app uses modal-state navigation (not React Navigation), keep the same pattern:
add a `detailExtension: McpExtensionRecord | null` state in `McpExtensionsScreen`. When
non-null, render `McpExtensionDetailScreen` in place of (or layered over) the list using
an animated slide or a nested modal.

**Recommended:** render `McpExtensionDetailScreen` as a full-screen modal with
`animationType="slide"` (matches iOS "push" feel without needing a stack navigator).

```
McpExtensionsScreen
  └─ (tap row) → detailExtension state set
       └─ <McpExtensionDetailScreen> (full-screen slide modal)
            ├─ (tap Configure) → <McpConnectorConfig> (sheet modal on top)
            └─ (tap Remove) → ActionSheet confirm → dismiss both modals
```

---

## Screen Layout — `McpExtensionDetailScreen`

```
┌─────────────────────────────────────────┐
│  < Back          [Extension name]        │
├─────────────────────────────────────────┤
│  [Icon]  Extension Name                 │
│          URL: https://...               │
├─────────────────────────────────────────┤
│  TOOLS                    [↻ Refresh]   │
│  ─────────────────────────────────────  │
│  • tool_name_one                        │
│    Description text if available        │
│  ─────────────────────────────────────  │
│  • tool_name_two                        │
│    ...                                  │
│  (loading spinner / error state)        │
├─────────────────────────────────────────┤
│  [Configure]           [Remove]         │
└─────────────────────────────────────────┘
```

---

## Components to Create / Modify

### 1. `components/settings/McpExtensionDetailScreen.tsx` (new)

**Props:**
```typescript
interface Props {
  extension: McpExtensionRecord;
  visible: boolean;
  onClose: () => void;
  onRemove: (id: string) => void;
  onUpdated: (updated: McpExtensionRecord) => void;
}
```

**State:**
```typescript
tools: McpTool[]          // fetched tool list
toolsLoading: boolean
toolsError: string | null
configureVisible: boolean
```

**Auto-refresh on mount:**
```typescript
useEffect(() => {
  fetchTools();
}, []); // runs once when modal becomes visible
```

**`fetchTools` function:**
- Instantiate `MCPClient` with `extension.serverUrl` + stored bearer token
  (call `getMcpBearerToken(extension.id)`)
- Call `client.listTools()` (or equivalent `tools/list` JSON-RPC call)
- On success: set `tools`, clear error
- On failure: set `toolsError`, keep stale tools if any

**Refresh button:** calls `fetchTools()` manually; shows `ActivityIndicator` in button
while loading.

**Pull-to-refresh:** wrap tools list in `ScrollView` with `refreshControl` prop
(`RefreshControl` component) — standard iOS pattern.

**Configure button:** sets `configureVisible = true`, renders `McpConnectorConfig`
in edit mode (pre-populated with current extension values).

**Remove button:** show iOS `ActionSheetIOS` (or cross-platform `Alert` with
destructive style) to confirm, then call `deleteMcpExtension(extension.id)`,
call `onRemove(extension.id)`, and close.

---

### 2. `components/settings/McpConnectorConfig.tsx` (modify)

Add an optional `existingExtension?: McpExtensionRecord` prop so it can pre-populate
fields for editing. On save in edit mode, update the record in storage instead of
adding a new one.

---

### 3. `components/settings/McpExtensionsScreen.tsx` (modify)

- Add state: `detailExtension: McpExtensionRecord | null`
- Make each list row tappable (`TouchableOpacity` / `Pressable`) → sets `detailExtension`
- Remove the inline delete button (Remove moves to detail screen)
- Render `<McpExtensionDetailScreen>` when `detailExtension !== null`
- Handle `onRemove`: remove from local `extensions` state + clear `detailExtension`
- Handle `onUpdated`: update extension in local `extensions` state

---

## Data / API

### Fetching Tools

Use `MCPClient` already in the codebase. Need a `listTools()` method if not already present:

```typescript
async listTools(): Promise<McpTool[]> {
  const response = await this.sendRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
    params: {}
  });
  return response.result?.tools ?? [];
}
```

`McpTool` type (add to `types.ts` if missing):
```typescript
interface McpTool {
  name: string;
  description?: string;
  inputSchema?: object;
}
```

---

## iOS Best Practices Checklist

- **Slide modal** (`animationType="slide"`) for detail screen — matches iOS push navigation feel
- **Back button** in header ("< Back" or chevron icon) closes modal
- **Pull-to-refresh** (`RefreshControl`) on tools list
- **Auto-refresh on screen appear** — call `fetchTools()` in `useEffect([], [])`
- **Loading state** — `ActivityIndicator` centered while first fetch runs; spinner in
  refresh button on subsequent fetches (keeps stale list visible)
- **Error state** — inline error message with "Retry" link, not a blocking alert
- **Destructive confirmation** — `ActionSheetIOS` with red "Remove" option for iOS;
  fall back to `Alert` with destructive button style on Android
- **Haptic feedback** — `Haptics.impactAsync(ImpactFeedbackStyle.Medium)` on Remove confirm
- **Empty tools state** — friendly message ("No tools found") rather than blank space
- **Safe area** — wrap in `SafeAreaView` to respect notch / home indicator

---

## Implementation Order

1. Add `listTools()` to `MCPClient` + `McpTool` type
2. Create `McpExtensionDetailScreen` with static info + Remove action (no tools yet)
3. Wire up tap-to-detail in `McpExtensionsScreen`
4. Add tools fetch + loading/error/refresh UI to detail screen
5. Add edit/configure support to `McpConnectorConfig` + wire Configure button
