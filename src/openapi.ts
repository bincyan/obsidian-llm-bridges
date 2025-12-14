/**
 * OpenAPI Server for LLM Bridges
 *
 * Exposes MCP tools as REST API endpoints with OpenAPI 3.0 documentation.
 * Runs on a standalone port, separate from the MCP SSE server.
 */

import * as http from "http";

// OpenAPI 3.0 Types
interface OpenAPIInfo {
  title: string;
  version: string;
  description: string;
}

interface OpenAPIServerDef {
  url: string;
  description?: string;
}

interface OpenAPISchema {
  type: string;
  properties?: Record<string, OpenAPISchemaProperty>;
  required?: string[];
  items?: OpenAPISchema;
  description?: string;
  default?: unknown;
  enum?: unknown[];
}

interface OpenAPISchemaProperty {
  type: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  items?: OpenAPISchema;
}

interface OpenAPIParameter {
  name: string;
  in: "query" | "path" | "header" | "cookie";
  description?: string;
  required?: boolean;
  schema: OpenAPISchema;
}

interface OpenAPIRequestBody {
  description?: string;
  required?: boolean;
  content: {
    [mediaType: string]: {
      schema: OpenAPISchema;
    };
  };
}

interface OpenAPIResponse {
  description: string;
  content?: {
    [mediaType: string]: {
      schema: OpenAPISchema;
    };
  };
}

interface OpenAPIOperation {
  operationId: string;
  summary: string;
  description?: string;
  tags?: string[];
  parameters?: OpenAPIParameter[];
  requestBody?: OpenAPIRequestBody;
  responses: Record<string, OpenAPIResponse>;
  security?: Array<Record<string, string[]>>;
}

interface OpenAPIPath {
  get?: OpenAPIOperation;
  post?: OpenAPIOperation;
  put?: OpenAPIOperation;
  delete?: OpenAPIOperation;
  patch?: OpenAPIOperation;
}

interface OpenAPISecurityScheme {
  type: "apiKey" | "http" | "oauth2" | "openIdConnect";
  description?: string;
  name?: string;
  in?: "query" | "header" | "cookie";
  scheme?: string;
  bearerFormat?: string;
}

interface OpenAPISpec {
  openapi: string;
  info: OpenAPIInfo;
  servers: OpenAPIServerDef[];
  paths: Record<string, OpenAPIPath>;
  components: {
    securitySchemes?: Record<string, OpenAPISecurityScheme>;
    schemas?: Record<string, OpenAPISchema>;
  };
  security?: Array<Record<string, string[]>>;
  tags?: Array<{ name: string; description: string }>;
}

// MCP Tool definition (matching main.ts)
interface MCPToolProperty {
  type: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
}

interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties?: Record<string, MCPToolProperty | undefined>;
    required?: string[];
  };
}

// Tool categories for OpenAPI tags
const TOOL_CATEGORIES: Record<string, { tag: string; description: string }> = {
  "list_knowledge_bases": { tag: "Knowledge Bases", description: "Knowledge Base management operations" },
  "add_knowledge_base": { tag: "Knowledge Bases", description: "Knowledge Base management operations" },
  "update_knowledge_base": { tag: "Knowledge Bases", description: "Knowledge Base management operations" },
  "add_knowledge_base_folder_constraint": { tag: "Knowledge Bases", description: "Knowledge Base management operations" },
  "list_notes": { tag: "Notes", description: "Note operations within Knowledge Bases" },
  "create_note": { tag: "Notes", description: "Note operations within Knowledge Bases" },
  "read_note": { tag: "Notes", description: "Note operations within Knowledge Bases" },
  "update_note": { tag: "Notes", description: "Note operations within Knowledge Bases" },
  "append_note": { tag: "Notes", description: "Note operations within Knowledge Bases" },
  "move_note": { tag: "Notes", description: "Note operations within Knowledge Bases" },
  "delete_note": { tag: "Notes", description: "Note operations within Knowledge Bases" },
  "list_vault_files": { tag: "Vault", description: "Direct vault operations" },
  "search_vault": { tag: "Vault", description: "Direct vault operations" },
  "get_active_note": { tag: "Vault", description: "Direct vault operations" },
  "list_commands": { tag: "Commands", description: "Obsidian command operations" },
  "execute_command": { tag: "Commands", description: "Obsidian command operations" },
};

/**
 * Generate OpenAPI 3.0 specification from MCP tools
 */
export function generateOpenAPISpec(
  tools: MCPTool[],
  serverUrl: string,
  version: string
): OpenAPISpec {
  const paths: Record<string, OpenAPIPath> = {};
  const tagsSet = new Set<string>();

  // Add health endpoint
  paths["/"] = {
    get: {
      operationId: "healthCheck",
      summary: "Health check",
      description: "Returns server status and version information",
      tags: ["System"],
      responses: {
        "200": {
          description: "Server is healthy",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  status: { type: "string", description: "Server status" },
                  version: { type: "string", description: "API version" },
                  vault: { type: "string", description: "Vault name" },
                },
              },
            },
          },
        },
      },
    },
  };
  tagsSet.add("System");

  // Add OpenAPI spec endpoint
  paths["/openapi.json"] = {
    get: {
      operationId: "getOpenAPISpec",
      summary: "Get OpenAPI specification",
      description: "Returns the OpenAPI 3.0 specification document",
      tags: ["System"],
      security: [], // No auth required
      responses: {
        "200": {
          description: "OpenAPI specification",
          content: {
            "application/json": {
              schema: {
                type: "object",
                description: "OpenAPI 3.0 specification document",
              },
            },
          },
        },
      },
    },
  };

  // Convert each MCP tool to an OpenAPI endpoint
  for (const tool of tools) {
    const category = TOOL_CATEGORIES[tool.name] || { tag: "Other", description: "Other operations" };
    tagsSet.add(category.tag);

    const path = `/api/${tool.name.replace(/_/g, "-")}`;
    const hasRequiredParams = (tool.inputSchema.required?.length ?? 0) > 0;
    const hasAnyParams = tool.inputSchema.properties && Object.keys(tool.inputSchema.properties).length > 0;

    // Determine HTTP method based on tool semantics
    let method: "get" | "post" | "put" | "delete" = "post";
    if (tool.name.startsWith("list_") || tool.name.startsWith("get_") || tool.name.startsWith("read_") || tool.name.startsWith("search_")) {
      method = hasRequiredParams ? "post" : "get"; // Use POST for complex queries
    } else if (tool.name.startsWith("delete_")) {
      method = "delete";
    } else if (tool.name.startsWith("update_")) {
      method = "put";
    }

    // Build request body schema
    const requestSchema: OpenAPISchema = {
      type: "object",
      properties: {},
      required: tool.inputSchema.required || [],
    };

    if (tool.inputSchema.properties) {
      for (const [propName, propDef] of Object.entries(tool.inputSchema.properties)) {
        if (propDef) {
          requestSchema.properties![propName] = {
            type: propDef.type,
            description: propDef.description,
            default: propDef.default,
            enum: propDef.enum,
          };
        }
      }
    }

    const operation: OpenAPIOperation = {
      operationId: tool.name,
      summary: tool.description,
      description: generateDetailedDescription(tool),
      tags: [category.tag],
      security: [{ BearerAuth: [] }],
      responses: {
        "200": {
          description: "Successful operation",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean" },
                  data: { type: "object", description: "Operation result" },
                },
              },
            },
          },
        },
        "400": {
          description: "Bad request - validation failed",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  error: { type: "string" },
                  details: { type: "string" },
                },
              },
            },
          },
        },
        "401": {
          description: "Unauthorized - missing or invalid authentication",
        },
        "404": {
          description: "Resource not found",
        },
        "500": {
          description: "Internal server error",
        },
      },
    };

    // Add request body for methods that need it
    if ((method === "post" || method === "put") && hasAnyParams) {
      operation.requestBody = {
        required: hasRequiredParams,
        content: {
          "application/json": {
            schema: requestSchema,
          },
        },
      };
    }

    // For GET requests with parameters, use query parameters
    if (method === "get" && hasAnyParams) {
      operation.parameters = [];
      if (tool.inputSchema.properties) {
        for (const [propName, propDef] of Object.entries(tool.inputSchema.properties)) {
          if (propDef) {
            operation.parameters.push({
              name: propName,
              in: "query",
              description: propDef.description,
              required: tool.inputSchema.required?.includes(propName) || false,
              schema: {
                type: propDef.type,
                default: propDef.default,
              },
            });
          }
        }
      }
    }

    // For DELETE with required params, use request body
    if (method === "delete" && hasAnyParams) {
      operation.requestBody = {
        required: hasRequiredParams,
        content: {
          "application/json": {
            schema: requestSchema,
          },
        },
      };
    }

    paths[path] = { [method]: operation };
  }

  // Build tags array
  const tags = Array.from(tagsSet).map((tag) => ({
    name: tag,
    description: getTagDescription(tag),
  }));

  return {
    openapi: "3.0.3",
    info: {
      title: "LLM Bridges API",
      version: version,
      description: `REST API for interacting with Obsidian vault through LLM Bridges.

This API exposes the same functionality as the MCP (Model Context Protocol) tools,
but through standard REST endpoints with OpenAPI documentation.

## Authentication

All endpoints (except /openapi.json) require Bearer token authentication.
Include your API key in the Authorization header:

\`\`\`
Authorization: Bearer your-api-key
\`\`\`

## Categories

- **Knowledge Bases**: Manage named collections of notes with validation rules
- **Notes**: CRUD operations on notes within Knowledge Bases
- **Vault**: Direct vault operations (file listing, search)
- **Commands**: Execute Obsidian commands`,
    },
    servers: [
      {
        url: serverUrl,
        description: "OpenAPI Server",
      },
    ],
    paths,
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "API Key or OAuth access token",
        },
      },
      schemas: {
        KnowledgeBase: {
          type: "object",
          properties: {
            name: { type: "string", description: "Unique name for the Knowledge Base" },
            description: { type: "string", description: "Human-readable description" },
            subfolder: { type: "string", description: "Root folder path in the vault" },
            organization_rules: { type: "string", description: "Organization rules (natural language)" },
          },
        },
        Note: {
          type: "object",
          properties: {
            path: { type: "string", description: "Full path to the note" },
            content: { type: "string", description: "Note content (markdown)" },
          },
        },
        ValidationResult: {
          type: "object",
          properties: {
            passed: { type: "boolean" },
            issues: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  field: { type: "string" },
                  message: { type: "string" },
                  severity: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
    security: [{ BearerAuth: [] }],
    tags,
  };
}

function generateDetailedDescription(tool: MCPTool): string {
  let desc = tool.description;

  if (tool.inputSchema.properties && Object.keys(tool.inputSchema.properties).length > 0) {
    desc += "\n\n**Parameters:**\n";
    for (const [name, prop] of Object.entries(tool.inputSchema.properties)) {
      if (prop) {
        const required = tool.inputSchema.required?.includes(name) ? " (required)" : " (optional)";
        desc += `- \`${name}\`${required}: ${prop.description || prop.type}\n`;
      }
    }
  }

  return desc;
}

function getTagDescription(tag: string): string {
  const descriptions: Record<string, string> = {
    "System": "System endpoints for health checks and API documentation",
    "Knowledge Bases": "Manage Knowledge Bases - named collections of notes with folder constraints and validation rules",
    "Notes": "CRUD operations on notes within Knowledge Bases, with automatic validation against folder constraints",
    "Vault": "Direct Obsidian vault operations - file listing, search, and active note access",
    "Commands": "Execute Obsidian commands programmatically",
    "Other": "Miscellaneous operations",
  };
  return descriptions[tag] || tag;
}

/**
 * Generate Swagger UI HTML page
 */
export function getSwaggerUIHtml(openApiUrl: string, title: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
  <style>
    html { box-sizing: border-box; overflow-y: scroll; }
    *, *:before, *:after { box-sizing: inherit; }
    body { margin: 0; background: #fafafa; }
    .swagger-ui .topbar { display: none; }
    .swagger-ui .info { margin: 20px 0; }
    .swagger-ui .info .title { font-size: 2em; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = function() {
      window.ui = SwaggerUIBundle({
        url: "${openApiUrl}",
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        plugins: [
          SwaggerUIBundle.plugins.DownloadUrl
        ],
        layout: "StandaloneLayout",
        persistAuthorization: true,
        tryItOutEnabled: true,
      });
    };
  </script>
</body>
</html>`;
}

// OpenAPI Server Settings
export interface OpenAPISettings {
  enabled: boolean;
  port: number;
  publicUrl?: string; // optional explicit public URL override for OpenAPI
}

export const DEFAULT_OPENAPI_SETTINGS: OpenAPISettings = {
  enabled: false,
  port: 3101,
  publicUrl: "",
};

// Callback types for tool execution
export type ToolExecutor = (name: string, args: Record<string, unknown>) => Promise<unknown>;
export type AuthChecker = (authHeader: string | undefined) => { authenticated: boolean; error?: string };
export type VaultInfo = () => { name: string; version: string };
export type OAuthRequestHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  baseUrl: string
) => Promise<boolean>;

/**
 * OpenAPI Server class - runs independently from MCP SSE server
 */
export class OpenAPIServer {
  private server: http.Server | null = null;
  private tools: MCPTool[] = [];
  private specCache: { serverUrl: string; spec: OpenAPISpec } | null = null;
  private settings: OpenAPISettings;
  private toolExecutor: ToolExecutor;
  private authChecker: AuthChecker;
  private vaultInfo: VaultInfo;
  private bindAddress: string;
  private publicUrl: string;
  private oauthHandler?: OAuthRequestHandler;

  constructor(
    settings: OpenAPISettings,
    bindAddress: string,
    publicUrl: string,
    toolExecutor: ToolExecutor,
    authChecker: AuthChecker,
    vaultInfo: VaultInfo,
    oauthHandler?: OAuthRequestHandler
  ) {
    this.settings = settings;
    this.bindAddress = bindAddress;
    this.publicUrl = publicUrl;
    this.toolExecutor = toolExecutor;
    this.authChecker = authChecker;
    this.vaultInfo = vaultInfo;
    this.oauthHandler = oauthHandler;
  }

  /**
   * Update tools list and regenerate OpenAPI spec
   */
  setTools(tools: MCPTool[]): void {
    this.tools = tools;
    this.specCache = null; // Will be regenerated on next request
  }

  /**
   * Get the OpenAPI specification
   */
  getSpec(serverUrl?: string): OpenAPISpec {
    const effectiveServerUrl = (serverUrl || this.getDefaultServerUrl()).replace(/\/$/, "");
    if (!this.specCache || this.specCache.serverUrl !== effectiveServerUrl) {
      const info = this.vaultInfo();
      this.specCache = {
        serverUrl: effectiveServerUrl,
        spec: generateOpenAPISpec(this.tools, effectiveServerUrl, info.version),
      };
    }
    return this.specCache.spec;
  }

  /**
   * Start the OpenAPI server
   */
  start(): void {
    if (this.server) {
      this.server.close();
    }

    if (!this.settings.enabled) {
      console.log("OpenAPI server is disabled");
      return;
    }

    this.server = http.createServer(async (req, res) => {
      // CORS headers
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url || "/", `http://${this.bindAddress}:${this.settings.port}`);
      const pathname = url.pathname;
      const serverUrl = this.getServerUrlFromRequest(req);

      try {
        // Public endpoints (no auth)
        if (pathname === "/openapi.json" && req.method === "GET") {
          const serverUrl = this.getServerUrlFromRequest(req);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(this.getSpec(serverUrl), null, 2));
          return;
        }

        if (pathname === "/docs" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(getSwaggerUIHtml("/openapi.json", "LLM Bridges API"));
          return;
        }

        // Health check
        if (pathname === "/" && req.method === "GET") {
          const info = this.vaultInfo();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            status: "ok",
            version: info.version,
            vault: info.name,
            openapi: true,
          }));
          return;
        }

        if (this.oauthHandler) {
          const handled = await this.oauthHandler(req, res, url, serverUrl);
          if (handled) return;
        }

        // Protected endpoints - check auth
        const authResult = this.authChecker(req.headers.authorization);
        if (!authResult.authenticated) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            error: "unauthorized",
            error_description: authResult.error || "Invalid or missing authentication",
          }));
          return;
        }

        // API tool endpoints
        if (pathname.startsWith("/api/")) {
          const toolName = pathname.slice(5).replace(/-/g, "_");
          const tool = this.tools.find((t) => t.name === toolName);

          if (!tool) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Tool not found", tool: toolName }));
            return;
          }

          // Parse arguments
          let args: Record<string, unknown> = {};

          if (req.method === "GET") {
            // Get args from query params
            for (const [key, value] of url.searchParams) {
              args[key] = value;
            }
          } else {
            // Get args from body
            const body = await this.readRequestBody(req);
            if (body) {
              try {
                args = JSON.parse(body);
              } catch {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Invalid JSON body" }));
                return;
              }
            }
          }

          // Execute tool
          try {
            const result = await this.toolExecutor(toolName, args);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, data: result }));
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const statusCode = message.includes("not found") ? 404 : 400;
            res.writeHead(statusCode, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: message }));
          }
          return;
        }

        // Not found
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
      } catch (error) {
        console.error("OpenAPI server error:", error);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    });

    this.server.listen(this.settings.port, this.bindAddress, () => {
      console.log(`OpenAPI server running at http://${this.bindAddress}:${this.settings.port}`);
      console.log(`Swagger UI: http://${this.bindAddress}:${this.settings.port}/docs`);
      console.log(`OpenAPI spec: http://${this.bindAddress}:${this.settings.port}/openapi.json`);
    });

    this.server.on("error", (err) => {
      console.error("OpenAPI server error:", err);
    });
  }

  /**
   * Stop the server
   */
  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  /**
   * Restart the server
   */
  restart(): void {
    this.stop();
    this.start();
  }

  /**
   * Update settings
   */
  updateSettings(settings: OpenAPISettings, bindAddress: string, publicUrl: string): void {
    this.settings = settings;
    this.bindAddress = bindAddress;
    this.publicUrl = publicUrl;
    this.specCache = null; // Regenerate spec with new server URL
  }

  /**
   * Check if server is running
   */
  isRunning(): boolean {
    return this.server !== null && this.server.listening;
  }

  private readRequestBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => resolve(body));
      req.on("error", reject);
    });
  }

  /**
   * Determine the server URL to advertise in the OpenAPI document.
   * Uses explicit publicUrl if provided; otherwise falls back to the
   * forwarded host/proto so Swagger UI uses the correct origin and avoids
   * mixed-content/CORS failures when accessed via HTTPS reverse proxies.
   */
  private getServerUrlFromRequest(req: http.IncomingMessage): string {
    const forwardedProto = (req.headers["x-forwarded-proto"] as string) || null;
    const forwardedHost = (req.headers["x-forwarded-host"] as string) || null;
    const host = forwardedHost || req.headers.host;

    // If a publicUrl exists, prefer it but adjust host/proto from forwarded headers when present.
    if (this.publicUrl) {
      try {
        const url = new URL(this.publicUrl);
        if (host) {
          url.host = host;
        }
        if (forwardedProto) {
          url.protocol = `${forwardedProto}:`;
        }
        return url.toString().replace(/\/$/, "");
      } catch {
        // fall through to header-derived
      }
    }

    if (host) {
      const proto = forwardedProto || "http";
      return `${proto}://${host}`.replace(/\/$/, "");
    }

    return this.getDefaultServerUrl();
  }

  /**
   * Fallback server URL when no request headers or publicUrl are available.
   * Uses localhost instead of bindAddress (which may be 0.0.0.0) to keep a
   * stable, reachable default during local development.
   */
  private getDefaultServerUrl(): string {
    if (this.publicUrl) {
      return this.publicUrl.replace(/\/$/, "");
    }
    return `http://127.0.0.1:${this.settings.port}`;
  }
}
