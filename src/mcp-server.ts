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
      // =========================================================================
      // Knowledge Base Management Tools
      // =========================================================================
      {
        name: "list_knowledge_bases",
        description:
          "List all defined Knowledge Bases in the vault. Returns name, description, subfolder, and creation time for each KB.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "add_knowledge_base",
        description:
          "Create a new Knowledge Base to manage notes in a specific vault subfolder. After creating a KB, you should define folder constraints using add_knowledge_base_folder_constraint.",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Unique identifier for the Knowledge Base",
            },
            description: {
              type: "string",
              description: "Human-readable description of what this KB is for",
            },
            subfolder: {
              type: "string",
              description:
                "Vault-relative folder path this KB will manage (e.g., 'research/ai')",
            },
            organization_rules: {
              type: "string",
              description:
                "Human-readable guidelines for note organization (Markdown). These rules are used for semantic validation by the LLM.",
            },
          },
          required: ["name", "description", "subfolder", "organization_rules"],
        },
      },
      {
        name: "update_knowledge_base",
        description: "Update metadata of an existing Knowledge Base",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Name of the KB to update",
            },
            description: {
              type: "string",
              description: "New description (optional)",
            },
            subfolder: {
              type: "string",
              description: "New subfolder path (optional)",
            },
            organization_rules: {
              type: "string",
              description: "New organization rules (optional)",
            },
          },
          required: ["name"],
        },
      },
      {
        name: "add_knowledge_base_folder_constraint",
        description:
          "Define machine-checkable metadata rules for notes under a specific subfolder of a KB. These rules are enforced automatically - notes that don't comply will be rejected.",
        inputSchema: {
          type: "object",
          properties: {
            kb_name: {
              type: "string",
              description: "Name of the Knowledge Base",
            },
            subfolder: {
              type: "string",
              description:
                "Target folder path (vault-relative) for this constraint",
            },
            rules: {
              type: "object",
              description: "Structured metadata requirements",
              properties: {
                frontmatter: {
                  type: "object",
                  properties: {
                    required_fields: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          name: { type: "string" },
                          type: {
                            type: "string",
                            enum: ["string", "number", "boolean", "date", "array"],
                          },
                          pattern: { type: "string" },
                          allowed_values: { type: "array" },
                        },
                        required: ["name", "type"],
                      },
                    },
                  },
                },
                filename: {
                  type: "object",
                  properties: {
                    pattern: {
                      type: "string",
                      description: "Regex pattern for valid filenames",
                    },
                  },
                },
                content: {
                  type: "object",
                  properties: {
                    min_length: { type: "number" },
                    max_length: { type: "number" },
                    required_sections: {
                      type: "array",
                      items: { type: "string" },
                    },
                  },
                },
              },
            },
          },
          required: ["kb_name", "subfolder", "rules"],
        },
      },

      // =========================================================================
      // Note Operations (KB-scoped with validation)
      // =========================================================================
      {
        name: "list_notes",
        description:
          "List all notes managed under a Knowledge Base. Optionally filter by subfolder.",
        inputSchema: {
          type: "object",
          properties: {
            knowledge_base_name: {
              type: "string",
              description: "Name of the Knowledge Base",
            },
            subfolder: {
              type: "string",
              description: "Optional subfolder filter within the KB",
            },
          },
          required: ["knowledge_base_name"],
        },
      },
      {
        name: "create_note",
        description:
          "Create a new note in a Knowledge Base. The note is validated against folder constraints before creation. Returns the KB's organization_rules for semantic validation.",
        inputSchema: {
          type: "object",
          properties: {
            knowledge_base_name: {
              type: "string",
              description: "Name of the Knowledge Base",
            },
            note_path: {
              type: "string",
              description: "Path for the note (relative to KB subfolder)",
            },
            note_content: {
              type: "string",
              description: "Full Markdown content for the note",
            },
          },
          required: ["knowledge_base_name", "note_path", "note_content"],
        },
      },
      {
        name: "read_note",
        description:
          "Read a note's content from a Knowledge Base. Supports pagination for large files.",
        inputSchema: {
          type: "object",
          properties: {
            knowledge_base_name: {
              type: "string",
              description: "Name of the Knowledge Base",
            },
            note_path: {
              type: "string",
              description: "Path to the note",
            },
            offset: {
              type: "number",
              description: "Character offset to start reading from (default: 0)",
            },
            limit: {
              type: "number",
              description: "Maximum characters to return (default: 10000)",
            },
          },
          required: ["knowledge_base_name", "note_path"],
        },
      },
      {
        name: "update_note",
        description:
          "Replace the entire content of an existing note. Returns both original and updated content for comparison. The note is validated against folder constraints.",
        inputSchema: {
          type: "object",
          properties: {
            knowledge_base_name: {
              type: "string",
              description: "Name of the Knowledge Base",
            },
            note_path: {
              type: "string",
              description: "Path to the note",
            },
            note_content: {
              type: "string",
              description: "New full Markdown content",
            },
          },
          required: ["knowledge_base_name", "note_path", "note_content"],
        },
      },
      {
        name: "append_note",
        description:
          "Append content to an existing note. Returns both original and updated content. The combined content is validated against folder constraints.",
        inputSchema: {
          type: "object",
          properties: {
            knowledge_base_name: {
              type: "string",
              description: "Name of the Knowledge Base",
            },
            note_path: {
              type: "string",
              description: "Path to the note",
            },
            note_content: {
              type: "string",
              description: "Content to append",
            },
          },
          required: ["knowledge_base_name", "note_path", "note_content"],
        },
      },
      {
        name: "move_note",
        description:
          "Move a note to a new path within the same KB. The note is validated against the new location's folder constraints.",
        inputSchema: {
          type: "object",
          properties: {
            knowledge_base_name: {
              type: "string",
              description: "Name of the Knowledge Base",
            },
            origin_note_path: {
              type: "string",
              description: "Current path of the note",
            },
            new_note_path: {
              type: "string",
              description: "Destination path for the note",
            },
          },
          required: ["knowledge_base_name", "origin_note_path", "new_note_path"],
        },
      },
      {
        name: "delete_note",
        description: "Delete a note from a Knowledge Base",
        inputSchema: {
          type: "object",
          properties: {
            knowledge_base_name: {
              type: "string",
              description: "Name of the Knowledge Base",
            },
            note_path: {
              type: "string",
              description: "Path to the note to delete",
            },
          },
          required: ["knowledge_base_name", "note_path"],
        },
      },

      // =========================================================================
      // Legacy Tools (for backward compatibility)
      // =========================================================================
      {
        name: "list_vault_files",
        description:
          "List all files and folders in the Obsidian vault or a specific directory. Use list_notes for KB-scoped listing.",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Path to list (empty for root)",
              default: "",
            },
          },
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
              description: "Number of characters of context around each match (default: 100)",
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
          "Execute an Obsidian command by its ID (e.g., 'app:open-settings')",
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
      // =======================================================================
      // Knowledge Base Management
      // =======================================================================
      case "list_knowledge_bases": {
        const response = await apiRequest("/kb");
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error?.message || `Failed to list KBs: ${response.status}`);
        }
        const data = await response.json();
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }

      case "add_knowledge_base": {
        const response = await apiRequest("/kb", {
          method: "POST",
          body: JSON.stringify({
            name: args?.name,
            description: args?.description,
            subfolder: args?.subfolder,
            organization_rules: args?.organization_rules,
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error?.message || `Failed to create KB: ${response.status}`);
        }

        const data = await response.json();
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }

      case "update_knowledge_base": {
        const response = await apiRequest("/kb", {
          method: "PUT",
          body: JSON.stringify({
            name: args?.name,
            description: args?.description,
            subfolder: args?.subfolder,
            organization_rules: args?.organization_rules,
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error?.message || `Failed to update KB: ${response.status}`);
        }

        const data = await response.json();
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }

      case "add_knowledge_base_folder_constraint": {
        const response = await apiRequest("/kb/constraint", {
          method: "POST",
          body: JSON.stringify({
            kb_name: args?.kb_name,
            subfolder: args?.subfolder,
            rules: args?.rules,
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error?.message || `Failed to add constraint: ${response.status}`);
        }

        const data = await response.json();
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }

      // =======================================================================
      // Note Operations (KB-scoped)
      // =======================================================================
      case "list_notes": {
        const kbName = args?.knowledge_base_name as string;
        const subfolder = args?.subfolder as string | undefined;

        if (!kbName) throw new Error("knowledge_base_name is required");

        const params = new URLSearchParams({ kb: kbName });
        if (subfolder) params.append("subfolder", subfolder);

        const response = await apiRequest(`/kb/notes?${params}`);

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error?.message || `Failed to list notes: ${response.status}`);
        }

        const data = await response.json();
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }

      case "create_note": {
        const response = await apiRequest("/kb/note/create", {
          method: "POST",
          body: JSON.stringify({
            knowledge_base_name: args?.knowledge_base_name,
            note_path: args?.note_path,
            note_content: args?.note_content,
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          // Include full error details for constraint violations
          if (error.error?.code === "folder_constraint_violation") {
            return {
              content: [
                {
                  type: "text",
                  text: `Constraint Violation: ${error.error.message}\n\nIssues:\n${JSON.stringify(error.error.issues, null, 2)}\n\nPlease fix the note content to satisfy the folder constraints and try again.`,
                },
              ],
              isError: true,
            };
          }
          throw new Error(error.error?.message || `Failed to create note: ${response.status}`);
        }

        const data = await response.json();
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }

      case "read_note": {
        const response = await apiRequest("/kb/note/read", {
          method: "POST",
          body: JSON.stringify({
            knowledge_base_name: args?.knowledge_base_name,
            note_path: args?.note_path,
            offset: args?.offset,
            limit: args?.limit,
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error?.message || `Failed to read note: ${response.status}`);
        }

        const data = await response.json();
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }

      case "update_note": {
        const response = await apiRequest("/kb/note/update", {
          method: "POST",
          body: JSON.stringify({
            knowledge_base_name: args?.knowledge_base_name,
            note_path: args?.note_path,
            note_content: args?.note_content,
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          if (error.error?.code === "folder_constraint_violation") {
            return {
              content: [
                {
                  type: "text",
                  text: `Constraint Violation: ${error.error.message}\n\nIssues:\n${JSON.stringify(error.error.issues, null, 2)}\n\nPlease fix the note content to satisfy the folder constraints and try again.`,
                },
              ],
              isError: true,
            };
          }
          throw new Error(error.error?.message || `Failed to update note: ${response.status}`);
        }

        const data = await response.json();
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }

      case "append_note": {
        const response = await apiRequest("/kb/note/append", {
          method: "POST",
          body: JSON.stringify({
            knowledge_base_name: args?.knowledge_base_name,
            note_path: args?.note_path,
            note_content: args?.note_content,
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          if (error.error?.code === "folder_constraint_violation") {
            return {
              content: [
                {
                  type: "text",
                  text: `Constraint Violation: ${error.error.message}\n\nIssues:\n${JSON.stringify(error.error.issues, null, 2)}\n\nPlease fix the content to satisfy the folder constraints and try again.`,
                },
              ],
              isError: true,
            };
          }
          throw new Error(error.error?.message || `Failed to append to note: ${response.status}`);
        }

        const data = await response.json();
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }

      case "move_note": {
        const response = await apiRequest("/kb/note/move", {
          method: "POST",
          body: JSON.stringify({
            knowledge_base_name: args?.knowledge_base_name,
            origin_note_path: args?.origin_note_path,
            new_note_path: args?.new_note_path,
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          if (error.error?.code === "folder_constraint_violation") {
            return {
              content: [
                {
                  type: "text",
                  text: `Constraint Violation: ${error.error.message}\n\nIssues:\n${JSON.stringify(error.error.issues, null, 2)}\n\nThe note cannot be moved to this location because it doesn't satisfy the folder constraints.`,
                },
              ],
              isError: true,
            };
          }
          throw new Error(error.error?.message || `Failed to move note: ${response.status}`);
        }

        const data = await response.json();
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }

      case "delete_note": {
        const response = await apiRequest("/kb/note/delete", {
          method: "POST",
          body: JSON.stringify({
            knowledge_base_name: args?.knowledge_base_name,
            note_path: args?.note_path,
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error?.message || `Failed to delete note: ${response.status}`);
        }

        const data = await response.json();
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }

      // =======================================================================
      // Legacy Tools
      // =======================================================================
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
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
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
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
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
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
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
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
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
          content: [{ type: "text", text: `Successfully executed command: ${commandId}` }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error: ${errorMessage}` }],
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
