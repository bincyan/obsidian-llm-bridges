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
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   ChatGPT /     │────▶│  Reverse Proxy  │────▶│  LLM Bridges    │────▶ Obsidian
│   Claude        │◀────│  (HTTPS)        │◀────│  (this plugin)  │◀────  Vault
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

The plugin runs a built-in MCP server with SSE transport directly inside Obsidian. All vault operations use Obsidian's native API. A reverse proxy (e.g., Nginx, Caddy) sits between the LLM (ChatGPT/Claude) and the plugin for HTTPS termination.

> **Note**: HTTPS is not provided by this plugin directly. You need to configure your own reverse proxy with SSL certificates for production use with web-based LLMs.

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
| `read_note` | Read note content |
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

## Setup

### 1. Enable the Plugin

After installing, enable the plugin in Obsidian. It will automatically:
- Generate an API key
- Start the MCP SSE server on port 3100

### 2. Configure Claude Desktop

Add the MCP server to your Claude configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "obsidian": {
      "url": "http://127.0.0.1:3100/sse",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY_HERE"
      }
    }
  }
}
```

**Tip**: Use the "Copy MCP Configuration" button in the plugin settings to get the config with your actual API key.

### 3. Restart Claude Desktop

Close and reopen Claude Desktop to load the MCP server.

### 4. Configure ChatGPT (Custom GPT / Actions)

ChatGPT can connect to your vault using the OpenAPI server, which exposes all tools as REST API endpoints.

#### Enable OpenAPI Server

1. Go to plugin settings in Obsidian
2. Enable **OpenAPI Server** (runs on port 3101 by default)
3. Set up HTTPS via reverse proxy (see step 5) - **ChatGPT requires HTTPS**

#### Set Up in ChatGPT

1. Create or edit a Custom GPT at [chat.openai.com](https://chat.openai.com)
2. Go to **Configure** → **Actions** → **Create new action**
3. Click **Import from URL** and enter your OpenAPI spec URL:
   ```
   https://your-domain.com/openapi.json
   ```
4. Configure authentication:
   - **Authentication Type**: API Key
   - **Auth Type**: Bearer
   - **API Key**: Your API key from plugin settings

#### OpenAPI Endpoints

| Endpoint | Description |
|----------|-------------|
| `/openapi.json` | OpenAPI 3.0 specification (no auth required) |
| `/docs` | Swagger UI for interactive API testing |
| `/api/*` | REST API endpoints (auth required) |

> **Note**: ChatGPT requires HTTPS. You must configure a reverse proxy with SSL certificates (see step 5).

### 5. (Optional) Configure Reverse Proxy for HTTPS

For web-based LLMs (ChatGPT, Claude web), set up a reverse proxy with HTTPS:

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────────────┐
│   ChatGPT /     │────▶│  Reverse Proxy  │────▶│  LLM Bridges Plugin     │
│   Claude Web    │◀────│  (HTTPS:443)    │◀────│  MCP SSE:3100           │
└─────────────────┘     └─────────────────┘     │  OpenAPI:3101           │
                                                └─────────────────────────┘
```

Example with Nginx:

```nginx
server {
    listen 443 ssl;
    server_name obsidian.yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # MCP SSE server (Claude web)
    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_set_header Host $host;
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding off;
    }

    # OpenAPI server (ChatGPT)
    location /openapi.json {
        proxy_pass http://127.0.0.1:3101/openapi.json;
    }

    location /docs {
        proxy_pass http://127.0.0.1:3101/docs;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3101/api/;
    }
}
```

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
- Change the MCP server port (default: 3100)
- Enable/configure the OpenAPI server (default port: 3101)
- Copy the MCP configuration for Claude Desktop
- Export OpenAPI spec to vault for reference
- Restart the servers

## Requirements

- Obsidian v0.15.0+
- ChatGPT Plus subscription (for ChatGPT integration via OpenAPI)
- Claude Pro subscription (for Claude integration via MCP)
- Obsidian must be running for LLM access

## Security

- Server runs locally on 127.0.0.1 only
- All requests require API key authentication (Bearer token)
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
│   ├── main.ts          # Obsidian plugin with built-in MCP server
│   ├── types.ts         # TypeScript type definitions
│   ├── validation.ts    # Knowledge Base validation engine
│   └── kb-manager.ts    # Knowledge Base management
├── tests/
│   ├── unit/            # Unit tests
│   ├── integration/     # Integration tests
│   └── mocks/           # Mock Obsidian API
├── spec/                # Specification documents
├── main.js              # Built Obsidian plugin
└── manifest.json
```

## Troubleshooting

### Server not starting

1. Check if another app is using port 3100
2. Try changing the port in settings
3. Restart the plugin

### Claude can't connect

1. Verify Obsidian is running with the plugin enabled
2. Check your `claude_desktop_config.json` syntax
3. Make sure the API key matches
4. Restart Claude Desktop

### ChatGPT can't connect

1. Verify the OpenAPI server is enabled and running (check plugin settings)
2. Ensure HTTPS is configured via reverse proxy (ChatGPT requires HTTPS)
3. Test the OpenAPI spec URL is accessible: `https://your-domain.com/openapi.json`
4. Verify the API key is correctly set in ChatGPT Actions

### Test the connection

```bash
# Test MCP server (Claude)
curl http://127.0.0.1:3100/
```

Should return: `{"status":"ok","version":"1.0.0","vault":"Your Vault Name"}`

```bash
# Test OpenAPI server (ChatGPT)
curl http://127.0.0.1:3101/openapi.json
```

Should return the OpenAPI 3.0 specification JSON.

## Author

**bincyan** - [bincyan.com](https://bincyan.com/)

## License

MIT License - see [LICENSE](LICENSE) for details.

## Contributing

Contributions welcome! Please open an issue or PR.
