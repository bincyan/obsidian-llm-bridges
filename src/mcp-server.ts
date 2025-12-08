import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const API_BASE = process.env.OBSIDIAN_API_URL || "http://127.0.0.1:27124";
const API_KEY = process.env.OBSIDIAN_API_KEY || "";

async function apiRequest(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) || {}),
  };

  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });
}

const server = new Server(
  { name: "obsidian-llm-bridges", version: "1.0.0" },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list_vault_files",
        description:
          "List all files and folders in the Obsidian vault or a specific directory",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description:
                "Path to list (empty for root, or a folder path like 'folder')",
              default: "",
            },
          },
        },
      },
      {
        name: "read_note",
        description:
          "Read the content of a note from the Obsidian vault. Returns content, frontmatter, and tags.",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description:
                "Path to the note file (e.g., 'folder/note.md' or 'note.md')",
            },
          },
          required: ["path"],
        },
      },
      {
        name: "write_note",
        description:
          "Create or overwrite a note in the Obsidian vault. Creates parent folders if needed.",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Path for the note file (e.g., 'folder/note.md')",
            },
            content: {
              type: "string",
              description: "Content to write to the note (markdown)",
            },
          },
          required: ["path", "content"],
        },
      },
      {
        name: "append_to_note",
        description:
          "Append content to an existing note. Creates the note if it doesn't exist.",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Path to the note file",
            },
            content: {
              type: "string",
              description: "Content to append to the note",
            },
          },
          required: ["path", "content"],
        },
      },
      {
        name: "delete_note",
        description: "Delete a note from the Obsidian vault",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Path to the note file to delete",
            },
          },
          required: ["path"],
        },
      },
      {
        name: "search_vault",
        description:
          "Search for text across all markdown notes in the vault. Returns matching files with context.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query text",
            },
            contextLength: {
              type: "number",
              description:
                "Number of characters of context around each match (default: 100)",
              default: 100,
            },
          },
          required: ["query"],
        },
      },
      {
        name: "get_active_note",
        description:
          "Get the currently active/open note in Obsidian. Returns content, frontmatter, and tags.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "list_commands",
        description: "List all available Obsidian commands that can be executed",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "execute_command",
        description:
          "Execute an Obsidian command by its ID (e.g., 'app:open-settings', 'editor:toggle-bold')",
        inputSchema: {
          type: "object",
          properties: {
            commandId: {
              type: "string",
              description: "The command ID to execute",
            },
          },
          required: ["commandId"],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "list_vault_files": {
        const path = (args?.path as string) || "";
        const queryParams = path ? `?path=${encodeURIComponent(path)}` : "";
        const response = await apiRequest(`/vault${queryParams}`);

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || `Failed to list files: ${response.status}`);
        }

        const data = await response.json();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      case "read_note": {
        const path = args?.path as string;
        if (!path) {
          throw new Error("Path is required");
        }

        const response = await apiRequest("/vault/read", {
          method: "POST",
          body: JSON.stringify({ path }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || `Failed to read note: ${response.status}`);
        }

        const data = await response.json();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      case "write_note": {
        const path = args?.path as string;
        const content = args?.content as string;

        if (!path) throw new Error("Path is required");
        if (content === undefined) throw new Error("Content is required");

        const response = await apiRequest("/vault/write", {
          method: "POST",
          body: JSON.stringify({ path, content }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || `Failed to write note: ${response.status}`);
        }

        return {
          content: [
            {
              type: "text",
              text: `Successfully wrote to ${path}`,
            },
          ],
        };
      }

      case "append_to_note": {
        const path = args?.path as string;
        const content = args?.content as string;

        if (!path) throw new Error("Path is required");
        if (content === undefined) throw new Error("Content is required");

        const response = await apiRequest("/vault/append", {
          method: "POST",
          body: JSON.stringify({ path, content }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || `Failed to append to note: ${response.status}`);
        }

        return {
          content: [
            {
              type: "text",
              text: `Successfully appended to ${path}`,
            },
          ],
        };
      }

      case "delete_note": {
        const path = args?.path as string;
        if (!path) throw new Error("Path is required");

        const response = await apiRequest("/vault/delete", {
          method: "POST",
          body: JSON.stringify({ path }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || `Failed to delete note: ${response.status}`);
        }

        return {
          content: [
            {
              type: "text",
              text: `Successfully deleted ${path}`,
            },
          ],
        };
      }

      case "search_vault": {
        const query = args?.query as string;
        const contextLength = (args?.contextLength as number) || 100;

        if (!query) throw new Error("Query is required");

        const response = await apiRequest("/search", {
          method: "POST",
          body: JSON.stringify({ query, contextLength }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || `Failed to search: ${response.status}`);
        }

        const data = await response.json();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      case "get_active_note": {
        const response = await apiRequest("/active");

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || `Failed to get active note: ${response.status}`);
        }

        const data = await response.json();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      case "list_commands": {
        const response = await apiRequest("/commands");

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || `Failed to list commands: ${response.status}`);
        }

        const data = await response.json();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }

      case "execute_command": {
        const commandId = args?.commandId as string;
        if (!commandId) throw new Error("Command ID is required");

        const response = await apiRequest("/commands/execute", {
          method: "POST",
          body: JSON.stringify({ commandId }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || `Failed to execute command: ${response.status}`);
        }

        return {
          content: [
            {
              type: "text",
              text: `Successfully executed command: ${commandId}`,
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: `Error: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
});

// List available resources
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  try {
    const response = await apiRequest("/vault");
    if (!response.ok) {
      return { resources: [] };
    }

    const data = await response.json();
    const resources = (data.files || [])
      .filter((f: string) => f.endsWith(".md"))
      .map((file: string) => ({
        uri: `obsidian://vault/${file}`,
        name: file,
        mimeType: "text/markdown",
      }));

    return { resources };
  } catch {
    return { resources: [] };
  }
});

// Read resource content
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;
  const path = uri.replace("obsidian://vault/", "");

  try {
    const response = await apiRequest("/vault/read", {
      method: "POST",
      body: JSON.stringify({ path }),
    });

    if (!response.ok) {
      throw new Error(`Failed to read: ${response.status}`);
    }

    const data = await response.json();
    return {
      contents: [
        {
          uri,
          mimeType: "text/markdown",
          text: data.content,
        },
      ],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read resource: ${errorMessage}`);
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Obsidian MCP Server running on stdio");
}

main().catch(console.error);
