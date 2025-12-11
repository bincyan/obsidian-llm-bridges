# LLM Bridges for Obsidian

Bridge your Obsidian vault with LLMs like ChatGPT and Claude. Read, write, and interact with your local vault using your existing subscriptions - no additional API keys required.

## Features

Use your existing ChatGPT Plus or Claude Pro subscription to:

- **Read** notes and files from your vault
- **Write** and create new content directly
- **Search** across your knowledge base
- **Execute** Obsidian commands remotely
- **Manage** Knowledge Bases with validation rules
- **Automate** workflows with your notes

No separate API keys needed. Just your existing subscription.

## How It Works

```
┌─────────────────┐     ┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   ChatGPT /     │────▶│  Reverse Proxy  │────▶│  MCP Server      │────▶│  LLM Bridges    │────▶ Obsidian
│   Claude        │◀────│  (HTTPS)        │◀────│  (this repo)     │◀────│  (this plugin)  │◀────  Vault
└─────────────────┘     └─────────────────┘     └──────────────────┘     └─────────────────┘
```

The plugin runs a local HTTP server inside Obsidian that exposes vault operations. The MCP server connects to the plugin's HTTP server. A reverse proxy (e.g., Nginx, Caddy) sits between the LLM (ChatGPT/Claude) and the MCP server, providing HTTPS termination for secure connections.

> **Note**: HTTPS is not provided by this repo directly. You need to configure your own reverse proxy with SSL certificates for production use.

## MCP Tools Available

### Knowledge Base Management

| Tool | Description |
|------|-------------|
| `list_knowledge_bases` | List all knowledge bases in the vault |
| `add_knowledge_base` | Create a new knowledge base with validation rules |
| `update_knowledge_base` | Update an existing knowledge base configuration |
| `add_knowledge_base_folder_constraint` | Add folder-specific validation rules to a KB |

### Note Operations (KB-aware)

| Tool | Description |
|------|-------------|
| `list_notes` | List notes within a knowledge base |
| `create_note` | Create a new note with validation |
| `read_note` | Read note content, frontmatter, and tags |
| `update_note` | Update an existing note with validation |
| `append_note` | Append content to an existing note |
| `move_note` | Move a note to a different location |
| `delete_note` | Delete a note from the vault |

### Vault Operations

| Tool | Description |
|------|-------------|
| `list_vault_files` | List files and folders in the vault |
| `search_vault` | Search text across all notes |
| `get_active_note` | Get the currently open note in Obsidian |

### Command Execution

| Tool | Description |
|------|-------------|
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

### 2. MCP Server Modes

The MCP server supports two transport modes:

| Mode | Port | Use Case |
|------|------|----------|
| **sse** (default) | 3100 | Web-based LLMs via reverse proxy |
| **stdio** | N/A | Claude Desktop (local) |

**Start MCP server (SSE mode)**:

```bash
MCP_API_KEY=your-secret-key \
OBSIDIAN_API_KEY=plugin-api-key \
npx obsidian-llm-bridges
```

**Environment variables**:

| Variable | Description | Default |
|----------|-------------|---------|
| `MCP_MODE` | Transport mode: `sse` or `stdio` | `sse` |
| `MCP_PORT` | SSE server port | `3100` |
| `MCP_API_KEY` | Bearer token for SSE authentication (LLM → MCP) | _(none)_ |
| `OBSIDIAN_API_URL` | Obsidian plugin HTTP server URL | `http://127.0.0.1:27124` |
| `OBSIDIAN_API_KEY` | API key for Obsidian plugin (MCP → Plugin) | _(none)_ |

**Authentication flow**:

```
LLM (ChatGPT/Claude)
    │
    │  Authorization: Bearer <MCP_API_KEY>
    ▼
MCP Server (SSE:3100)
    │
    │  Authorization: Bearer <OBSIDIAN_API_KEY>
    ▼
Obsidian Plugin (HTTP:27124)
    │
    ▼
Vault
```

### 3. (Optional) Configure Reverse Proxy for HTTPS

For secure connections from ChatGPT/Claude to the MCP server, set up a reverse proxy with HTTPS:

```
┌─────────────────┐     ┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   ChatGPT /     │────▶│  Reverse Proxy  │────▶│  MCP Server      │────▶│  LLM Bridges    │
│   Claude        │◀────│  (HTTPS:443)    │◀────│  (SSE:3100)      │◀────│  (HTTP:27124)   │
└─────────────────┘     └─────────────────┘     └──────────────────┘     └─────────────────┘
```

Example with Nginx:

```nginx
server {
    listen 443 ssl;
    server_name mcp.yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_set_header Host $host;
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding off;
    }
}
```

> **Note**: HTTPS is not provided by this repo directly. You need to configure your own reverse proxy with SSL certificates.

### 4. Configure Claude Desktop

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
        "OBSIDIAN_API_URL": "https://obsidian.localhost",
        "OBSIDIAN_API_KEY": "YOUR_API_KEY_HERE"
      }
    }
  }
}
```

For local development without HTTPS:

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

### 5. Restart Claude Desktop

Close and reopen Claude Desktop to load the MCP server.

### 6. Start Using

You can now ask Claude to:

- "List all knowledge bases in my vault"
- "Create a new knowledge base for my projects"
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
- (Optional) Reverse proxy with SSL for HTTPS connections

## Security

- Server runs locally on 127.0.0.1 only
- All requests require API key authentication
- No data leaves your machine except to the LLM you're using
- HTTPS encryption available via reverse proxy
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

### Test

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
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
│   ├── mcp-server.ts    # MCP server for Claude
│   ├── types.ts         # TypeScript type definitions
│   ├── validation.ts    # Knowledge Base validation engine
│   └── kb-manager.ts    # Knowledge Base management
├── tests/
│   ├── unit/            # Unit tests
│   ├── integration/     # Integration tests
│   └── mocks/           # Mock Obsidian API
├── spec/                # Specification documents
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
5. If using HTTPS, verify your reverse proxy is running

### Test the connection

```bash
# Direct connection (HTTP)
curl -H "Authorization: Bearer YOUR_API_KEY" http://127.0.0.1:27124/

# Via reverse proxy (HTTPS)
curl -H "Authorization: Bearer YOUR_API_KEY" https://obsidian.localhost/
```

Should return: `{"status":"ok","version":"1.0.0","vault":"Your Vault Name"}`

## Author

**bincyan** - [bincyan.com](https://bincyan.com/)

## License

MIT License - see [LICENSE](LICENSE) for details.

## Contributing

Contributions welcome! Please open an issue or PR.
