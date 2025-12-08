# LLM Bridges for Obsidian

Bridge your Obsidian vault with LLMs like ChatGPT and Claude. Read, write, and interact with your local vault using your existing subscriptions - no additional API keys required.

## Features

Use your existing ChatGPT Plus or Claude Pro subscription to:

- **Read** notes and files from your vault
- **Write** and create new content directly
- **Search** across your knowledge base
- **Execute** Obsidian commands remotely
- **Automate** workflows with your notes

No separate API keys needed. Just your existing subscription.

## How It Works

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   ChatGPT /     │────▶│  MCP Server      │────▶│  LLM Bridges    │────▶ Obsidian Vault
│   Claude        │◀────│  (npx)           │◀────│  (this plugin)  │◀────
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

The plugin runs a local HTTP server inside Obsidian that exposes vault operations. The MCP server (run via npx) connects Claude to this local server.

## MCP Tools Available

| Tool | Description |
|------|-------------|
| `list_vault_files` | List files and folders in the vault |
| `read_note` | Read content, frontmatter, and tags |
| `write_note` | Create or overwrite a note |
| `append_to_note` | Append content to existing note |
| `delete_note` | Delete a note |
| `search_vault` | Search text across all notes |
| `get_active_note` | Get currently open note |
| `list_commands` | List available Obsidian commands |
| `execute_command` | Execute an Obsidian command |

## Installation

### From Community Plugins (Coming Soon)

1. Open Settings → Community Plugins
2. Search for "LLM Bridges"
3. Install and Enable

### Manual Installation

1. Download `main.js` and `manifest.json` from [Releases](https://github.com/bincyan/obsidian-llm-bridges/releases)
2. Create `.obsidian/plugins/obsidian-llm-bridges/` in your vault
3. Copy the files into the folder
4. Reload Obsidian and enable the plugin

## Setup for Claude

### 1. Enable the Plugin

After installing, enable the plugin in Obsidian. It will automatically:
- Generate an API key
- Start the local server on port 27124

### 2. Configure Claude Desktop

Add the MCP server to your Claude configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "npx",
      "args": ["-y", "obsidian-llm-bridges"],
      "env": {
        "OBSIDIAN_API_URL": "http://127.0.0.1:27124",
        "OBSIDIAN_API_KEY": "YOUR_API_KEY_HERE"
      }
    }
  }
}
```

**Tip**: Use the "Copy MCP Configuration" button in the plugin settings to get the config with your actual API key.

### 3. Restart Claude Desktop

Close and reopen Claude Desktop to load the MCP server.

### 4. Start Using

You can now ask Claude to:

- "List all notes in my vault"
- "Read my daily note"
- "Create a new note called 'Meeting Notes' with today's agenda"
- "Search my vault for 'project ideas'"
- "Append this summary to my journal"

## Configuration

Open the plugin settings in Obsidian to:

- View and copy your API key
- Change the server port (default: 27124)
- Copy the MCP configuration
- Restart the server

## Requirements

- Obsidian v0.15.0+
- Claude Pro subscription (for Claude integration)
- Node.js 18+ (for running the MCP server via npx)

## Security

- Server runs locally on 127.0.0.1 only
- All requests require API key authentication
- No data leaves your machine except to the LLM you're using
- You control what the LLM can access

## Development

### Setup

```bash
git clone https://github.com/bincyan/obsidian-llm-bridges.git
cd obsidian-llm-bridges
npm install
```

### Build

```bash
# Build Obsidian plugin
npm run build

# Build MCP server
npm run build:mcp

# Build both
npm run build:all
```

### Development Mode

```bash
npm run dev
```

### Project Structure

```
obsidian-llm-bridges/
├── src/
│   ├── main.ts          # Obsidian plugin (HTTP server)
│   └── mcp-server.ts    # MCP server for Claude
├── dist/
│   └── mcp-server.js    # Built MCP server
├── main.js              # Built Obsidian plugin
└── manifest.json
```

## Troubleshooting

### Server not starting

1. Check if another app is using port 27124
2. Try changing the port in settings
3. Restart the plugin

### Claude can't connect

1. Verify Obsidian is running with the plugin enabled
2. Check your `claude_desktop_config.json` syntax
3. Make sure the API key matches
4. Restart Claude Desktop

### Test the connection

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" http://127.0.0.1:27124/
```

Should return: `{"status":"ok","version":"1.0.0","vault":"Your Vault Name"}`

## Author

**bincyan** - [bincyan.com](https://bincyan.com/)

## License

MIT License - see [LICENSE](LICENSE) for details.

## Contributing

Contributions welcome! Please open an issue or PR.
