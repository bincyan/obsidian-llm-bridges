import {
  App,
  Command,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  TFolder,
  prepareSimpleSearch,
} from "obsidian";

// Extend App type to include internal commands API
declare module "obsidian" {
  interface App {
    commands: {
      commands: Record<string, Command>;
      executeCommandById(id: string): boolean;
    };
  }
}
import * as http from "http";
import { KBManager } from "./kb-manager";
import { validateNote, findApplicableConstraint, validateConstraintRulesSchema } from "./validation";
import {
  KnowledgeBase,
  FolderConstraint,
  ConstraintRules,
  ValidationResult,
  DEFAULT_READ_LIMIT,
} from "./types";
import {
  OAuthManager,
  OAuthSettings,
  DEFAULT_OAUTH_SETTINGS,
  getAuthorizationServerMetadata,
  getProtectedResourceMetadata,
  getAuthorizationPageHtml,
  getErrorPageHtml,
} from "./oauth";

// MCP Protocol types
interface MCPRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface MCPResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

type AuthMethod = "apiKey" | "oauth";

interface LLMBridgesSettings {
  hostname: string;       // Server hostname (default: 127.0.0.1)
  port: number;           // MCP SSE server port
  apiKey: string;         // API key for authentication
  authMethod: AuthMethod; // Authentication method: API Key or OAuth 2.1
  oauth: OAuthSettings;   // OAuth 2.1 settings
}

const DEFAULT_SETTINGS: LLMBridgesSettings = {
  hostname: "127.0.0.1",
  port: 3100,
  apiKey: "",
  authMethod: "apiKey",
  oauth: DEFAULT_OAUTH_SETTINGS,
};

export default class LLMBridgesPlugin extends Plugin {
  settings: LLMBridgesSettings;
  server: http.Server | null = null;
  sessions: Map<string, http.ServerResponse> = new Map();
  kbManager: KBManager;
  oauthManager: OAuthManager | null = null;
  tokenCleanupInterval: ReturnType<typeof setInterval> | null = null;

  async onload() {
    await this.loadSettings();
    this.kbManager = new KBManager(this.app);

    // Generate API key if not set
    if (!this.settings.apiKey) {
      this.settings.apiKey = this.generateApiKey();
      await this.saveSettings();
    }

    // Initialize OAuth manager
    this.initOAuthManager();

    // Start token cleanup interval (every 5 minutes)
    this.tokenCleanupInterval = setInterval(() => {
      this.oauthManager?.cleanupExpiredTokens();
    }, 5 * 60 * 1000);

    // Add settings tab
    this.addSettingTab(new LLMBridgesSettingTab(this.app, this));

    // Add ribbon icon
    this.addRibbonIcon("bot", "LLM Bridges", () => {
      new Notice(
        this.server
          ? `LLM Bridges running on port ${this.settings.port}`
          : "LLM Bridges server not running"
      );
    });

    // Add commands
    this.addCommand({
      id: "copy-mcp-config",
      name: "Copy Claude MCP Configuration",
      callback: () => this.copyMCPConfig(),
    });

    this.addCommand({
      id: "restart-server",
      name: "Restart Server",
      callback: () => this.restartServer(),
    });

    // Start MCP SSE server
    this.startServer();
  }

  private initOAuthManager(): void {
    this.oauthManager = new OAuthManager(
      this.settings.oauth,
      async (oauthSettings) => {
        this.settings.oauth = oauthSettings;
        await this.saveSettings();
      }
    );
  }

  onunload() {
    if (this.tokenCleanupInterval) {
      clearInterval(this.tokenCleanupInterval);
    }
    this.stopServer();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  generateApiKey(): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    for (let i = 0; i < 32; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  // ===========================================================================
  // MCP SSE Server with OAuth 2.1 Support
  // ===========================================================================

  private getBaseUrl(): string {
    return `http://${this.settings.hostname}:${this.settings.port}`;
  }

  startServer() {
    if (this.server) {
      this.server.close();
    }

    this.server = http.createServer(async (req, res) => {
      // CORS headers
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url || "/", this.getBaseUrl());

      // =========================================================================
      // Public Endpoints (no auth required)
      // =========================================================================

      // Health check
      if (url.pathname === "/" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          status: "ok",
          version: this.manifest.version,
          vault: this.app.vault.getName(),
          authMethod: this.settings.authMethod,
        }));
        return;
      }

      // OAuth 2.1 Authorization Server Metadata (RFC 8414)
      if (url.pathname === "/.well-known/oauth-authorization-server" && req.method === "GET") {
        const metadata = getAuthorizationServerMetadata(this.getBaseUrl());
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(metadata));
        return;
      }

      // Protected Resource Metadata (MCP Spec)
      if (url.pathname === "/.well-known/oauth-protected-resource" && req.method === "GET") {
        const metadata = getProtectedResourceMetadata(this.getBaseUrl());
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(metadata));
        return;
      }

      // =========================================================================
      // OAuth 2.1 Endpoints
      // =========================================================================

      // Authorization endpoint
      if (url.pathname === "/oauth/authorize" && req.method === "GET") {
        if (this.settings.authMethod !== "oauth" || !this.oauthManager) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "invalid_request", error_description: "OAuth not enabled" }));
          return;
        }

        const clientId = url.searchParams.get("client_id");
        const redirectUri = url.searchParams.get("redirect_uri");
        const responseType = url.searchParams.get("response_type");
        const codeChallenge = url.searchParams.get("code_challenge");
        const codeChallengeMethod = url.searchParams.get("code_challenge_method");
        const scope = url.searchParams.get("scope") || "mcp:read mcp:write";
        const state = url.searchParams.get("state");

        // Validate required parameters
        if (!clientId || !redirectUri || !responseType || !codeChallenge || !codeChallengeMethod) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(getErrorPageHtml("Invalid Request", "Missing required OAuth parameters"));
          return;
        }

        if (responseType !== "code") {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(getErrorPageHtml("Unsupported Response Type", "Only 'code' response type is supported"));
          return;
        }

        if (codeChallengeMethod !== "S256") {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(getErrorPageHtml("Unsupported Code Challenge Method", "Only S256 is supported"));
          return;
        }

        // Validate client
        const client = this.oauthManager.getClient(clientId);
        if (!client) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(getErrorPageHtml("Unknown Client", `Client '${clientId}' is not registered`));
          return;
        }

        // Validate redirect URI
        if (!this.oauthManager.validateRedirectUri(clientId, redirectUri)) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(getErrorPageHtml("Invalid Redirect URI", "The redirect URI is not allowed for this client"));
          return;
        }

        // Generate authorization code
        const authCode = this.oauthManager.generateAuthorizationCode(
          clientId,
          redirectUri,
          codeChallenge,
          "S256",
          scope
        );

        // Show authorization page
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(getAuthorizationPageHtml(client.client_name, scope, authCode.code, redirectUri, state || undefined));
        return;
      }

      // Authorization decision endpoint
      if (url.pathname === "/oauth/authorize/decision" && req.method === "POST") {
        if (!this.oauthManager) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "invalid_request" }));
          return;
        }

        const body = await this.readRequestBody(req);
        const params = new URLSearchParams(body);
        const decision = params.get("decision");
        const code = params.get("code");
        const redirectUri = params.get("redirect_uri");
        const state = params.get("state");

        if (!code || !redirectUri) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(getErrorPageHtml("Invalid Request", "Missing required parameters"));
          return;
        }

        const redirectUrl = new URL(redirectUri);

        if (decision === "approve") {
          this.oauthManager.approveAuthorizationCode(code);
          redirectUrl.searchParams.set("code", code);
          if (state) redirectUrl.searchParams.set("state", state);
        } else {
          this.oauthManager.denyAuthorizationCode(code);
          redirectUrl.searchParams.set("error", "access_denied");
          redirectUrl.searchParams.set("error_description", "User denied the authorization request");
          if (state) redirectUrl.searchParams.set("state", state);
        }

        res.writeHead(302, { Location: redirectUrl.toString() });
        res.end();
        return;
      }

      // Token endpoint
      if (url.pathname === "/oauth/token" && req.method === "POST") {
        if (this.settings.authMethod !== "oauth" || !this.oauthManager) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "invalid_request", error_description: "OAuth not enabled" }));
          return;
        }

        const body = await this.readRequestBody(req);
        const contentType = req.headers["content-type"] || "";

        let params: URLSearchParams;
        if (contentType.includes("application/json")) {
          const json = JSON.parse(body);
          params = new URLSearchParams(json);
        } else {
          params = new URLSearchParams(body);
        }

        const grantType = params.get("grant_type");
        const clientId = params.get("client_id");

        if (!grantType || !clientId) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "invalid_request", error_description: "Missing required parameters" }));
          return;
        }

        if (grantType === "authorization_code") {
          const code = params.get("code");
          const redirectUri = params.get("redirect_uri");
          const codeVerifier = params.get("code_verifier");

          if (!code || !redirectUri || !codeVerifier) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "invalid_request", error_description: "Missing required parameters" }));
            return;
          }

          const result = this.oauthManager.exchangeCodeForTokens(code, clientId, redirectUri, codeVerifier);

          if ("error" in result) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify(result));
            return;
          }

          res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          res.end(JSON.stringify({
            access_token: result.access_token.access_token,
            token_type: result.access_token.token_type,
            expires_in: result.access_token.expires_in,
            refresh_token: result.refresh_token?.refresh_token,
            scope: result.access_token.scope,
          }));
          return;
        }

        if (grantType === "refresh_token") {
          const refreshToken = params.get("refresh_token");

          if (!refreshToken) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "invalid_request", error_description: "Missing refresh_token" }));
            return;
          }

          const result = this.oauthManager.refreshAccessToken(refreshToken, clientId);

          if ("error" in result) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify(result));
            return;
          }

          res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          res.end(JSON.stringify({
            access_token: result.access_token.access_token,
            token_type: result.access_token.token_type,
            expires_in: result.access_token.expires_in,
            refresh_token: result.refresh_token?.refresh_token,
            scope: result.access_token.scope,
          }));
          return;
        }

        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unsupported_grant_type" }));
        return;
      }

      // Token revocation endpoint
      if (url.pathname === "/oauth/revoke" && req.method === "POST") {
        if (!this.oauthManager) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "invalid_request" }));
          return;
        }

        const body = await this.readRequestBody(req);
        const params = new URLSearchParams(body);
        const token = params.get("token");

        if (token) {
          this.oauthManager.revokeToken(token);
        }

        // Always return 200 OK per RFC 7009
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ revoked: true }));
        return;
      }

      // =========================================================================
      // Protected Endpoints (auth required)
      // =========================================================================

      // Authentication check
      const authResult = this.checkAuthentication(req);
      if (!authResult.authenticated) {
        const headers: Record<string, string> = { "Content-Type": "application/json" };

        // Add WWW-Authenticate header for OAuth mode (MCP spec requirement)
        if (this.settings.authMethod === "oauth") {
          headers["WWW-Authenticate"] = `Bearer resource_metadata="${this.getBaseUrl()}/.well-known/oauth-protected-resource"`;
        }

        res.writeHead(401, headers);
        res.end(JSON.stringify({
          error: "unauthorized",
          error_description: authResult.error || "Invalid or missing authentication",
        }));
        return;
      }

      // SSE endpoint - establish connection
      if (url.pathname === "/sse" && req.method === "GET") {
        const sessionId = this.generateSessionId();
        console.log(`MCP: New SSE connection ${sessionId}`);

        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        });

        // Send endpoint info
        res.write(`event: endpoint\ndata: /messages?sessionId=${sessionId}\n\n`);

        this.sessions.set(sessionId, res);

        req.on("close", () => {
          console.log(`MCP: SSE connection closed ${sessionId}`);
          this.sessions.delete(sessionId);
        });

        return;
      }

      // Message endpoint - receive JSON-RPC messages
      if (url.pathname === "/messages" && req.method === "POST") {
        const sessionId = url.searchParams.get("sessionId");
        if (!sessionId || !this.sessions.has(sessionId)) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Session not found" }));
          return;
        }

        const body = await this.readRequestBody(req);
        try {
          const request = JSON.parse(body) as MCPRequest;
          const response = await this.handleMCPRequest(request);

          // Send response via SSE
          const sseRes = this.sessions.get(sessionId);
          if (sseRes) {
            sseRes.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
          }

          res.writeHead(202, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "accepted" }));
        } catch (error) {
          console.error("MCP: Error handling message:", error);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Internal server error" }));
        }
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    });

    this.server.listen(this.settings.port, this.settings.hostname, () => {
      console.log(`LLM Bridges MCP Server listening on ${this.getBaseUrl()}`);
      console.log(`Auth method: ${this.settings.authMethod}`);
    });

    this.server.on("error", (err) => {
      console.error("MCP Server error:", err);
      new Notice(`LLM Bridges: Server error - ${err.message}`);
    });
  }

  // ===========================================================================
  // Authentication Helpers
  // ===========================================================================

  private checkAuthentication(req: http.IncomingMessage): { authenticated: boolean; error?: string } {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return { authenticated: false, error: "Missing Authorization header" };
    }

    if (!authHeader.startsWith("Bearer ")) {
      return { authenticated: false, error: "Invalid authorization scheme" };
    }

    const token = authHeader.slice(7);

    if (this.settings.authMethod === "apiKey") {
      // API Key authentication
      if (token === this.settings.apiKey) {
        return { authenticated: true };
      }
      return { authenticated: false, error: "Invalid API key" };
    }

    if (this.settings.authMethod === "oauth") {
      // OAuth 2.1 authentication
      if (!this.oauthManager) {
        return { authenticated: false, error: "OAuth not configured" };
      }

      const accessToken = this.oauthManager.validateAccessToken(token);
      if (accessToken) {
        return { authenticated: true };
      }
      return { authenticated: false, error: "Invalid or expired access token" };
    }

    return { authenticated: false, error: "Unknown authentication method" };
  }

  private readRequestBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => resolve(body));
      req.on("error", reject);
    });
  }

  stopServer() {
    // Close all SSE connections
    for (const [sessionId, res] of this.sessions) {
      res.end();
    }
    this.sessions.clear();

    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  restartServer() {
    this.stopServer();
    this.startServer();
    new Notice(`LLM Bridges restarted on port ${this.settings.port}`);
  }

  generateSessionId(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }

  // ===========================================================================
  // MCP Request Handler
  // ===========================================================================

  async handleMCPRequest(request: MCPRequest): Promise<MCPResponse> {
    const { id, method, params } = request;

    try {
      let result: unknown;

      switch (method) {
        case "initialize":
          result = {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {}, resources: {} },
            serverInfo: { name: "obsidian-llm-bridges", version: this.manifest.version },
          };
          break;

        case "tools/list":
          result = { tools: this.getMCPTools() };
          break;

        case "tools/call":
          result = await this.handleMCPToolCall(params as { name: string; arguments: Record<string, unknown> });
          break;

        case "resources/list":
          result = { resources: this.getMCPResources() };
          break;

        case "resources/read":
          result = await this.handleMCPResourceRead(params as { uri: string });
          break;

        default:
          return {
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: `Method not found: ${method}` },
          };
      }

      return { jsonrpc: "2.0", id, result };
    } catch (error) {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32000, message: error instanceof Error ? error.message : String(error) },
      };
    }
  }

  getMCPTools() {
    return [
      // Knowledge Base Management
      {
        name: "list_knowledge_bases",
        description: "List all defined Knowledge Bases in the vault",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "add_knowledge_base",
        description: "Create a new Knowledge Base",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Unique name for the KB" },
            description: { type: "string", description: "Human-readable description" },
            subfolder: { type: "string", description: "Root folder path" },
            organization_rules: { type: "string", description: "Organization rules (natural language)" },
          },
          required: ["name", "description", "subfolder"],
        },
      },
      {
        name: "update_knowledge_base",
        description: "Update an existing Knowledge Base configuration",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Name of the KB to update" },
            description: { type: "string", description: "New description" },
            subfolder: { type: "string", description: "New root folder path" },
            organization_rules: { type: "string", description: "New organization rules" },
          },
          required: ["name"],
        },
      },
      {
        name: "add_knowledge_base_folder_constraint",
        description: "Add folder-specific validation rules to a Knowledge Base",
        inputSchema: {
          type: "object",
          properties: {
            kb_name: { type: "string", description: "Knowledge Base name" },
            subfolder: { type: "string", description: "Subfolder within KB" },
            rules: { type: "object", description: "Constraint rules (required_frontmatter_fields, etc.)" },
          },
          required: ["kb_name", "subfolder", "rules"],
        },
      },
      // Note Operations
      {
        name: "list_notes",
        description: "List all notes in a Knowledge Base",
        inputSchema: {
          type: "object",
          properties: {
            knowledge_base_name: { type: "string" },
            subfolder: { type: "string", description: "Optional subfolder within KB" },
          },
          required: ["knowledge_base_name"],
        },
      },
      {
        name: "create_note",
        description: "Create a new note with validation",
        inputSchema: {
          type: "object",
          properties: {
            knowledge_base_name: { type: "string" },
            note_path: { type: "string" },
            note_content: { type: "string" },
          },
          required: ["knowledge_base_name", "note_path", "note_content"],
        },
      },
      {
        name: "read_note",
        description: "Read a note's content",
        inputSchema: {
          type: "object",
          properties: {
            knowledge_base_name: { type: "string" },
            note_path: { type: "string" },
            offset: { type: "number" },
            limit: { type: "number" },
          },
          required: ["knowledge_base_name", "note_path"],
        },
      },
      {
        name: "update_note",
        description: "Update an existing note",
        inputSchema: {
          type: "object",
          properties: {
            knowledge_base_name: { type: "string" },
            note_path: { type: "string" },
            note_content: { type: "string" },
          },
          required: ["knowledge_base_name", "note_path", "note_content"],
        },
      },
      {
        name: "append_note",
        description: "Append content to an existing note",
        inputSchema: {
          type: "object",
          properties: {
            knowledge_base_name: { type: "string" },
            note_path: { type: "string" },
            note_content: { type: "string" },
          },
          required: ["knowledge_base_name", "note_path", "note_content"],
        },
      },
      {
        name: "move_note",
        description: "Move a note to a different location",
        inputSchema: {
          type: "object",
          properties: {
            knowledge_base_name: { type: "string" },
            origin_note_path: { type: "string" },
            new_note_path: { type: "string" },
          },
          required: ["knowledge_base_name", "origin_note_path", "new_note_path"],
        },
      },
      {
        name: "delete_note",
        description: "Delete a note",
        inputSchema: {
          type: "object",
          properties: {
            knowledge_base_name: { type: "string" },
            note_path: { type: "string" },
          },
          required: ["knowledge_base_name", "note_path"],
        },
      },
      // Vault Operations
      {
        name: "list_vault_files",
        description: "List files in the vault",
        inputSchema: {
          type: "object",
          properties: { path: { type: "string", description: "Folder path (optional)" } },
          required: [],
        },
      },
      {
        name: "search_vault",
        description: "Search text across all notes",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            context_length: { type: "number", default: 100 },
          },
          required: ["query"],
        },
      },
      {
        name: "get_active_note",
        description: "Get the currently open note",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      // Commands
      {
        name: "list_commands",
        description: "List available Obsidian commands",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "execute_command",
        description: "Execute an Obsidian command",
        inputSchema: {
          type: "object",
          properties: { command_id: { type: "string" } },
          required: ["command_id"],
        },
      },
    ];
  }

  getMCPResources() {
    return [
      {
        uri: "obsidian://vault",
        name: "Vault Info",
        description: "Current vault information",
        mimeType: "application/json",
      },
      {
        uri: "obsidian://knowledge-bases",
        name: "Knowledge Bases",
        description: "All defined Knowledge Bases",
        mimeType: "application/json",
      },
    ];
  }

  async handleMCPToolCall(params: { name: string; arguments: Record<string, unknown> }): Promise<{ content: Array<{ type: string; text: string }> }> {
    const { name, arguments: args } = params;
    let result: unknown;

    switch (name) {
      // Knowledge Base Management
      case "list_knowledge_bases": {
        const kbs = await this.kbManager.listKnowledgeBases();
        result = { knowledge_bases: kbs };
        break;
      }

      case "add_knowledge_base": {
        const kb = await this.kbManager.addKnowledgeBase(
          args.name as string,
          args.description as string,
          args.subfolder as string,
          args.organization_rules as string || ""
        );
        result = { knowledge_base: kb };
        break;
      }

      case "update_knowledge_base": {
        const kb = await this.kbManager.updateKnowledgeBase(args.name as string, {
          description: args.description as string | undefined,
          subfolder: args.subfolder as string | undefined,
          organization_rules: args.organization_rules as string | undefined,
        });
        result = { knowledge_base: kb };
        break;
      }

      case "add_knowledge_base_folder_constraint": {
        const schemaValidation = validateConstraintRulesSchema(args.rules as ConstraintRules);
        if (!schemaValidation.passed) {
          throw new Error(`Invalid constraint rules: ${schemaValidation.issues.map(i => i.message).join(", ")}`);
        }
        const constraint = await this.kbManager.addFolderConstraint(
          args.kb_name as string,
          args.subfolder as string,
          args.rules as ConstraintRules
        );
        result = { folder_constraint: constraint };
        break;
      }

      // Note Operations
      case "list_notes": {
        const kb = await this.kbManager.getKnowledgeBase(args.knowledge_base_name as string);
        if (!kb) throw new Error(`Knowledge base '${args.knowledge_base_name}' not found`);

        const searchPath = args.subfolder
          ? this.kbManager.resolveNotePath(kb, args.subfolder as string)
          : kb.subfolder;

        const notes: { path: string }[] = [];
        const folder = this.app.vault.getAbstractFileByPath(searchPath);
        if (folder instanceof TFolder) {
          const collectNotes = (f: TFolder) => {
            for (const child of f.children) {
              if (child instanceof TFile && child.extension === "md") {
                notes.push({ path: child.path });
              } else if (child instanceof TFolder) {
                collectNotes(child);
              }
            }
          };
          collectNotes(folder);
        }
        result = { knowledge_base: kb, notes };
        break;
      }

      case "create_note": {
        const kb = await this.kbManager.getKnowledgeBase(args.knowledge_base_name as string);
        if (!kb) throw new Error(`Knowledge base '${args.knowledge_base_name}' not found`);

        const resolvedPath = this.kbManager.resolveNotePath(kb, args.note_path as string);
        if (this.kbManager.noteExists(resolvedPath)) {
          throw new Error(`Note already exists at '${resolvedPath}'`);
        }

        // Validate
        const constraints = await this.kbManager.getFolderConstraints(kb.name);
        const constraint = findApplicableConstraint(resolvedPath, constraints);
        let validation: ValidationResult = { passed: true, issues: [] };
        if (constraint) {
          validation = validateNote(resolvedPath, args.note_content as string, constraint);
          if (!validation.passed) {
            throw new Error(`Validation failed: ${validation.issues.map(i => i.message).join(", ")}`);
          }
        }

        // Create folders and note
        const folderPath = resolvedPath.substring(0, resolvedPath.lastIndexOf("/"));
        if (folderPath) await this.ensureFolder(folderPath);
        await this.app.vault.create(resolvedPath, args.note_content as string);

        result = { path: resolvedPath, validation };
        break;
      }

      case "read_note": {
        const kb = await this.kbManager.getKnowledgeBase(args.knowledge_base_name as string);
        if (!kb) throw new Error(`Knowledge base '${args.knowledge_base_name}' not found`);

        const resolvedPath = this.kbManager.resolveNotePath(kb, args.note_path as string);
        const file = this.app.vault.getAbstractFileByPath(resolvedPath);
        if (!(file instanceof TFile)) throw new Error(`Note not found at '${resolvedPath}'`);

        const content = await this.app.vault.read(file);
        const offset = (args.offset as number) || 0;
        const limit = (args.limit as number) || DEFAULT_READ_LIMIT;
        const chunk = content.slice(offset, offset + limit);

        result = {
          path: resolvedPath,
          content: chunk,
          offset,
          has_more: offset + limit < content.length,
        };
        break;
      }

      case "update_note": {
        const kb = await this.kbManager.getKnowledgeBase(args.knowledge_base_name as string);
        if (!kb) throw new Error(`Knowledge base '${args.knowledge_base_name}' not found`);

        const resolvedPath = this.kbManager.resolveNotePath(kb, args.note_path as string);
        const file = this.app.vault.getAbstractFileByPath(resolvedPath);
        if (!(file instanceof TFile)) throw new Error(`Note not found at '${resolvedPath}'`);

        // Validate
        const constraints = await this.kbManager.getFolderConstraints(kb.name);
        const constraint = findApplicableConstraint(resolvedPath, constraints);
        if (constraint) {
          const validation = validateNote(resolvedPath, args.note_content as string, constraint);
          if (!validation.passed) {
            throw new Error(`Validation failed: ${validation.issues.map(i => i.message).join(", ")}`);
          }
        }

        await this.app.vault.modify(file, args.note_content as string);
        result = { path: resolvedPath, success: true };
        break;
      }

      case "append_note": {
        const kb = await this.kbManager.getKnowledgeBase(args.knowledge_base_name as string);
        if (!kb) throw new Error(`Knowledge base '${args.knowledge_base_name}' not found`);

        const resolvedPath = this.kbManager.resolveNotePath(kb, args.note_path as string);
        const file = this.app.vault.getAbstractFileByPath(resolvedPath);
        if (!(file instanceof TFile)) throw new Error(`Note not found at '${resolvedPath}'`);

        const existingContent = await this.app.vault.read(file);
        const newContent = existingContent.endsWith("\n")
          ? existingContent + (args.note_content as string)
          : existingContent + "\n" + (args.note_content as string);

        // Validate combined content
        const constraints = await this.kbManager.getFolderConstraints(kb.name);
        const constraint = findApplicableConstraint(resolvedPath, constraints);
        if (constraint) {
          const validation = validateNote(resolvedPath, newContent, constraint);
          if (!validation.passed) {
            throw new Error(`Validation failed: ${validation.issues.map(i => i.message).join(", ")}`);
          }
        }

        await this.app.vault.modify(file, newContent);
        result = { path: resolvedPath, success: true };
        break;
      }

      case "move_note": {
        const kb = await this.kbManager.getKnowledgeBase(args.knowledge_base_name as string);
        if (!kb) throw new Error(`Knowledge base '${args.knowledge_base_name}' not found`);

        const originPath = this.kbManager.resolveNotePath(kb, args.origin_note_path as string);
        const newPath = this.kbManager.resolveNotePath(kb, args.new_note_path as string);

        const originFile = this.app.vault.getAbstractFileByPath(originPath);
        if (!(originFile instanceof TFile)) throw new Error(`Note not found at '${originPath}'`);

        if (this.kbManager.noteExists(newPath)) {
          throw new Error(`Note already exists at '${newPath}'`);
        }

        // Validate against new path's constraints
        const content = await this.app.vault.read(originFile);
        const constraints = await this.kbManager.getFolderConstraints(kb.name);
        const constraint = findApplicableConstraint(newPath, constraints);
        if (constraint) {
          const validation = validateNote(newPath, content, constraint);
          if (!validation.passed) {
            throw new Error(`Validation failed for new location: ${validation.issues.map(i => i.message).join(", ")}`);
          }
        }

        // Create parent folders
        const newFolderPath = newPath.substring(0, newPath.lastIndexOf("/"));
        if (newFolderPath) await this.ensureFolder(newFolderPath);

        await this.app.vault.rename(originFile, newPath);
        result = { origin_path: originPath, new_path: newPath };
        break;
      }

      case "delete_note": {
        const kb = await this.kbManager.getKnowledgeBase(args.knowledge_base_name as string);
        if (!kb) throw new Error(`Knowledge base '${args.knowledge_base_name}' not found`);

        const resolvedPath = this.kbManager.resolveNotePath(kb, args.note_path as string);
        const file = this.app.vault.getAbstractFileByPath(resolvedPath);
        if (!(file instanceof TFile)) throw new Error(`Note not found at '${resolvedPath}'`);

        await this.app.vault.delete(file);
        result = { deleted_path: resolvedPath };
        break;
      }

      // Vault Operations
      case "list_vault_files": {
        const files: string[] = [];
        const folderPath = (args.path as string) || "";

        const listRecursive = (folder: TFolder) => {
          for (const child of folder.children) {
            if (child instanceof TFile) files.push(child.path);
            else if (child instanceof TFolder) files.push(child.path + "/");
          }
        };

        if (folderPath) {
          const folder = this.app.vault.getAbstractFileByPath(folderPath);
          if (folder instanceof TFolder) listRecursive(folder);
        } else {
          listRecursive(this.app.vault.getRoot());
        }
        result = { files };
        break;
      }

      case "search_vault": {
        const search = prepareSimpleSearch(args.query as string);
        const contextLength = (args.context_length as number) || 100;
        const results: Array<{ path: string; matches: Array<{ context: string }> }> = [];

        for (const file of this.app.vault.getMarkdownFiles()) {
          const content = await this.app.vault.cachedRead(file);
          const searchResult = search(content);
          if (searchResult) {
            results.push({
              path: file.path,
              matches: searchResult.matches.map((m) => ({
                context: content.slice(Math.max(0, m[0] - contextLength), m[1] + contextLength),
              })),
            });
          }
        }
        result = { results };
        break;
      }

      case "get_active_note": {
        const file = this.app.workspace.getActiveFile();
        if (!file) throw new Error("No active file");
        const content = await this.app.vault.read(file);
        result = { path: file.path, content };
        break;
      }

      // Commands
      case "list_commands": {
        const commands = Object.values(this.app.commands.commands).map((c) => ({
          id: c.id,
          name: c.name,
        }));
        result = { commands };
        break;
      }

      case "execute_command": {
        const cmdId = args.command_id as string;
        if (!this.app.commands.commands[cmdId]) {
          throw new Error(`Command not found: ${cmdId}`);
        }
        this.app.commands.executeCommandById(cmdId);
        result = { success: true };
        break;
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }

  async handleMCPResourceRead(params: { uri: string }): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
    const { uri } = params;

    if (uri === "obsidian://vault") {
      return {
        contents: [{
          uri,
          mimeType: "application/json",
          text: JSON.stringify({
            name: this.app.vault.getName(),
            files: this.app.vault.getMarkdownFiles().length,
          }),
        }],
      };
    }

    if (uri === "obsidian://knowledge-bases") {
      const kbs = await this.kbManager.listKnowledgeBases();
      return {
        contents: [{
          uri,
          mimeType: "application/json",
          text: JSON.stringify({ knowledge_bases: kbs }),
        }],
      };
    }

    throw new Error(`Unknown resource: ${uri}`);
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  private async ensureFolder(path: string): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing) return;

    const parts = path.split("/");
    let currentPath = "";

    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const folder = this.app.vault.getAbstractFileByPath(currentPath);
      if (!folder) {
        await this.app.vault.createFolder(currentPath);
      }
    }
  }

  copyMCPConfig() {
    let config;

    if (this.settings.authMethod === "oauth") {
      // OAuth configuration (Claude will handle the OAuth flow)
      config = {
        mcpServers: {
          obsidian: {
            url: `http://127.0.0.1:${this.settings.port}/sse`,
          },
        },
      };
    } else {
      // API Key configuration
      config = {
        mcpServers: {
          obsidian: {
            url: `http://127.0.0.1:${this.settings.port}/sse`,
            headers: {
              Authorization: `Bearer ${this.settings.apiKey}`,
            },
          },
        },
      };
    }

    navigator.clipboard.writeText(JSON.stringify(config, null, 2));
    new Notice("MCP configuration copied to clipboard!");
  }
}

class LLMBridgesSettingTab extends PluginSettingTab {
  plugin: LLMBridgesPlugin;

  constructor(app: App, plugin: LLMBridgesPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "LLM Bridges Settings" });

    // Status
    const statusEl = containerEl.createEl("div", { cls: "llm-bridges-status" });
    statusEl.createEl("p", {
      text: `MCP Server running on http://${this.plugin.settings.hostname}:${this.plugin.settings.port}`,
    });
    statusEl.createEl("p", {
      text: `Authentication: ${this.plugin.settings.authMethod === "oauth" ? "OAuth 2.1" : "API Key"}`,
      cls: "llm-bridges-auth-status",
    });

    // ===========================================================================
    // Authentication Method Selection
    // ===========================================================================
    containerEl.createEl("h3", { text: "Authentication" });

    new Setting(containerEl)
      .setName("Authentication Method")
      .setDesc("Choose how clients authenticate with the MCP server")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("apiKey", "API Key (Simple)")
          .addOption("oauth", "OAuth 2.1 (Recommended for Claude)")
          .setValue(this.plugin.settings.authMethod)
          .onChange(async (value) => {
            this.plugin.settings.authMethod = value as AuthMethod;
            await this.plugin.saveSettings();
            this.plugin.restartServer();
            this.display();
          })
      );

    // ===========================================================================
    // API Key Settings (shown when apiKey method selected)
    // ===========================================================================
    if (this.plugin.settings.authMethod === "apiKey") {
      new Setting(containerEl)
        .setName("API Key")
        .setDesc("Used to authenticate MCP requests (Bearer token)")
        .addText((text) =>
          text
            .setValue(this.plugin.settings.apiKey)
            .setDisabled(true)
        )
        .addButton((btn) =>
          btn.setButtonText("Copy").onClick(() => {
            navigator.clipboard.writeText(this.plugin.settings.apiKey);
            new Notice("API Key copied!");
          })
        )
        .addButton((btn) =>
          btn.setButtonText("Regenerate").onClick(async () => {
            this.plugin.settings.apiKey = this.plugin.generateApiKey();
            await this.plugin.saveSettings();
            this.display();
            new Notice("API Key regenerated!");
          })
        );
    }

    // ===========================================================================
    // OAuth 2.1 Settings (shown when oauth method selected)
    // ===========================================================================
    if (this.plugin.settings.authMethod === "oauth") {
      const oauthSection = containerEl.createEl("div", { cls: "llm-bridges-oauth-section" });

      oauthSection.createEl("p", {
        text: "OAuth 2.1 is enabled. Claude Desktop will automatically authenticate using the OAuth flow.",
        cls: "setting-item-description",
      });

      // OAuth Endpoints Info
      const baseUrl = `http://${this.plugin.settings.hostname}:${this.plugin.settings.port}`;
      const endpointsEl = oauthSection.createEl("div", { cls: "llm-bridges-oauth-endpoints" });
      endpointsEl.createEl("h4", { text: "OAuth Endpoints" });
      const endpointsList = endpointsEl.createEl("ul");
      endpointsList.createEl("li", {
        text: `Authorization: ${baseUrl}/oauth/authorize`,
      });
      endpointsList.createEl("li", {
        text: `Token: ${baseUrl}/oauth/token`,
      });
      endpointsList.createEl("li", {
        text: `Metadata: ${baseUrl}/.well-known/oauth-authorization-server`,
      });

      // Token Lifetimes
      new Setting(oauthSection)
        .setName("Access Token Lifetime")
        .setDesc("How long access tokens remain valid (in seconds)")
        .addText((text) =>
          text
            .setValue(String(this.plugin.settings.oauth.access_token_lifetime))
            .setPlaceholder("3600")
            .onChange(async (value) => {
              const lifetime = parseInt(value);
              if (!isNaN(lifetime) && lifetime > 0) {
                this.plugin.settings.oauth.access_token_lifetime = lifetime;
                await this.plugin.saveSettings();
              }
            })
        );

      new Setting(oauthSection)
        .setName("Refresh Token Lifetime")
        .setDesc("How long refresh tokens remain valid (in seconds)")
        .addText((text) =>
          text
            .setValue(String(this.plugin.settings.oauth.refresh_token_lifetime))
            .setPlaceholder("604800")
            .onChange(async (value) => {
              const lifetime = parseInt(value);
              if (!isNaN(lifetime) && lifetime > 0) {
                this.plugin.settings.oauth.refresh_token_lifetime = lifetime;
                await this.plugin.saveSettings();
              }
            })
        );

      // Registered Clients
      const clientsEl = oauthSection.createEl("div", { cls: "llm-bridges-oauth-clients" });
      clientsEl.createEl("h4", { text: "Registered Clients" });

      const clients = this.plugin.settings.oauth.clients;
      if (clients.length === 0) {
        clientsEl.createEl("p", {
          text: "No clients registered. Claude Desktop will be automatically registered on first connection.",
          cls: "setting-item-description",
        });
      } else {
        const clientsList = clientsEl.createEl("ul");
        for (const client of clients) {
          clientsList.createEl("li", {
            text: `${client.client_name} (${client.client_id})`,
          });
        }
      }
    }

    // ===========================================================================
    // Server Settings
    // ===========================================================================
    containerEl.createEl("h3", { text: "Server" });

    new Setting(containerEl)
      .setName("Hostname")
      .setDesc("Server hostname/IP to bind to (use 0.0.0.0 to listen on all interfaces)")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.hostname)
          .setPlaceholder("127.0.0.1")
          .onChange(async (value) => {
            if (value.trim()) {
              this.plugin.settings.hostname = value.trim();
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Port")
      .setDesc("Port for the MCP SSE server (requires restart)")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.port))
          .onChange(async (value) => {
            const port = parseInt(value);
            if (!isNaN(port) && port > 0 && port < 65536) {
              this.plugin.settings.port = port;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Restart Server")
      .setDesc("Apply settings changes")
      .addButton((btn) =>
        btn.setButtonText("Restart").onClick(() => {
          this.plugin.restartServer();
        })
      );

    // ===========================================================================
    // Claude Desktop Setup
    // ===========================================================================
    containerEl.createEl("h3", { text: "Claude Desktop Setup" });

    const instructionsEl = containerEl.createEl("div");
    instructionsEl.createEl("p", {
      text: "Add this to your Claude Desktop configuration:",
    });

    const configEl = containerEl.createEl("pre", {
      cls: "llm-bridges-config",
    });

    const serverUrl = `http://${this.plugin.settings.hostname}:${this.plugin.settings.port}`;
    if (this.plugin.settings.authMethod === "oauth") {
      configEl.setText(`{
  "mcpServers": {
    "obsidian": {
      "url": "${serverUrl}/sse"
    }
  }
}

Note: When using OAuth, Claude will automatically discover
the authorization endpoints and prompt you to authorize.`);
    } else {
      configEl.setText(`{
  "mcpServers": {
    "obsidian": {
      "url": "${serverUrl}/sse",
      "headers": {
        "Authorization": "Bearer ${this.plugin.settings.apiKey}"
      }
    }
  }
}`);
    }

    new Setting(containerEl).addButton((btn) =>
      btn
        .setButtonText("Copy MCP Configuration")
        .setCta()
        .onClick(() => this.plugin.copyMCPConfig())
    );

    // Config file locations
    containerEl.createEl("h4", { text: "Config File Locations" });
    const locationsEl = containerEl.createEl("ul");
    locationsEl.createEl("li", {
      text: "macOS: ~/Library/Application Support/Claude/claude_desktop_config.json",
    });
    locationsEl.createEl("li", {
      text: "Windows: %APPDATA%\\Claude\\claude_desktop_config.json",
    });

    // Version info
    const versionEl = containerEl.createEl("div", { cls: "llm-bridges-version" });
    versionEl.createEl("p", {
      text: `LLM Bridges v${this.plugin.manifest.version}`,
      cls: "setting-item-description",
    });
  }
}
