import LLMBridgesPlugin from "../src/main";
import { KBManager } from "../src/kb-manager";
import { createMockApp, TFile } from "../tests/mocks/obsidian";

type ToolCall = { name: string; arguments: Record<string, unknown> };

type CaseResult = {
  scope: string;
  tool: string;
  input: Record<string, unknown>;
  output: unknown;
  errors: string[];
};

const manifest = {
  id: "obsidian-llm-bridges",
  name: "LLM Bridges",
  version: "0.0.0",
  minAppVersion: "0.0.0",
  description: "Contract runner",
  author: "scripts",
};

function getByPath(value: unknown, path: string): unknown {
  if (value === null || value === undefined) return undefined;
  const parts = path.split(".");
  let current: any = value;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return current;
}

function checkPaths(output: unknown, paths: string[]): string[] {
  const errors: string[] = [];
  for (const path of paths) {
    const value = getByPath(output, path);
    if (value === undefined) {
      errors.push(`missing path: ${path}`);
    }
  }
  return errors;
}

function printCase(result: CaseResult) {
  const { scope, tool, input, output, errors } = result;
  const status = errors.length === 0 ? "PASS" : "FAIL";

  console.log(`\n[${scope}] ${tool} -> ${status}`);
  console.log("input:");
  console.log(JSON.stringify(input, null, 2));
  console.log("output:");
  console.log(JSON.stringify(output, null, 2));
  if (errors.length) {
    console.log("errors:");
    console.log(JSON.stringify(errors, null, 2));
  }
  console.log("==========");
}

export async function run() {
  const app = createMockApp();
  const plugin = new LLMBridgesPlugin(app as any, manifest as any);
  plugin.kbManager = new KBManager(app as any);

  const callTool = async (name: string, args: Record<string, unknown>) => {
    const result = await plugin.handleMCPToolCall({ name, arguments: args } as ToolCall);
    const text = result.content[0]?.text ?? "";
    return JSON.parse(text || "{}");
  };

  // Seed vault data used by multiple scopes.
  await app.vault.create("docs/readme.md", "Search target\nMore content");
  await app.vault.create("notes/active.md", "Active content");
  app.workspace.getActiveFile = () => new TFile("notes/active.md");

  const executed: string[] = [];
  app.commands.commands = {
    "test-command": { id: "test-command", name: "Test Command" },
  };
  app.commands.executeCommandById = (id: string) => {
    executed.push(id);
    return true;
  };

  const results: CaseResult[] = [];

  const record = (
    scope: string,
    tool: string,
    input: Record<string, unknown>,
    output: unknown,
    expectPaths: string[] = [],
    extraChecks: Array<(value: unknown) => string | null> = []
  ) => {
    const errors = checkPaths(output, expectPaths);
    for (const check of extraChecks) {
      const error = check(output);
      if (error) errors.push(error);
    }
    results.push({ scope, tool, input, output, errors });
  };

  // Knowledge base scope
  const listEmpty = await callTool("list_knowledge_bases", {});
  record("knowledge_bases", "list_knowledge_bases", {}, listEmpty, ["knowledge_bases"], [
    (value) => {
      const list = (value as any).knowledge_bases;
      if (!Array.isArray(list)) return "knowledge_bases is not an array";
      if (list.length !== 0) return "expected empty knowledge_bases";
      return null;
    },
  ]);

  const addedKb = await callTool("add_knowledge_base", {
    name: "kb-contracts",
    description: "KB for contracts",
    subfolder: "notes",
  });
  record("knowledge_bases", "add_knowledge_base", {
    name: "kb-contracts",
    description: "KB for contracts",
    subfolder: "notes",
  }, addedKb, ["knowledge_base"], [
    (value) => ((value as any).knowledge_base?.name === "kb-contracts" ? null : "expected knowledge_base.name"),
  ]);

  const updatedKb = await callTool("update_knowledge_base", {
    name: "kb-contracts",
    description: "KB for contracts (updated)",
  });
  record("knowledge_bases", "update_knowledge_base", {
    name: "kb-contracts",
    description: "KB for contracts (updated)",
  }, updatedKb, ["knowledge_base"], [
    (value) => ((value as any).knowledge_base?.description?.includes("updated") ? null : "expected updated description"),
  ]);

  const addedKbNoConstraint = await callTool("add_knowledge_base", {
    name: "kb-no-constraints",
    description: "KB without constraints",
    subfolder: "docs",
  });
  record(
    "knowledge_bases",
    "add_knowledge_base",
    {
      name: "kb-no-constraints",
      description: "KB without constraints",
      subfolder: "docs",
    },
    addedKbNoConstraint,
    ["knowledge_base"],
    [(value) => ((value as any).knowledge_base?.name === "kb-no-constraints" ? null : "expected knowledge_base.name")]
  );

  // Constraints scope
  const addedConstraint = await callTool("add_knowledge_base_folder_constraint", {
    kb_name: "kb-contracts",
    subfolder: "notes",
    rules: {
      frontmatter: {
        required_fields: [{ name: "title", type: "string" }],
      },
    },
  });
  record(
    "constraints",
    "add_knowledge_base_folder_constraint",
    {
      kb_name: "kb-contracts",
      subfolder: "notes",
      rules: { frontmatter: { required_fields: [{ name: "title", type: "string" }] } },
    },
    addedConstraint,
    ["folder_constraint"]
  );

  // Notes scope
  const createdNoteWithConstraint = await callTool("create_note", {
    knowledge_base_name: "kb-contracts",
    note_path: "first.md",
    note_content: "---\ntitle: First\n---\nHello",
  });
  record(
    "notes",
    "create_note",
    {
      knowledge_base_name: "kb-contracts",
      note_path: "first.md",
      note_content: "---\ntitle: First\n---\nHello",
    },
    createdNoteWithConstraint,
    ["path", "content", "validation", "validation_instruction_for_llm"],
    [
      (value) => ((value as any).path === "notes/first.md" ? null : "expected path notes/first.md"),
      (value) => ((value as any).validation?.folder_constraint ? null : "expected folder_constraint in validation"),
    ]
  );

  const createdNoteNoConstraint = await callTool("create_note", {
    knowledge_base_name: "kb-no-constraints",
    note_path: "unconstrained.md",
    note_content: "---\ntitle: No Constraint\n---\nHello",
  });
  record(
    "notes",
    "create_note",
    {
      knowledge_base_name: "kb-no-constraints",
      note_path: "unconstrained.md",
      note_content: "---\ntitle: No Constraint\n---\nHello",
    },
    createdNoteNoConstraint,
    ["path", "content", "validation", "validation_instruction_for_llm"],
    [
      (value) => ((value as any).path === "docs/unconstrained.md" ? null : "expected path docs/unconstrained.md"),
      (value) => ((value as any).validation?.folder_constraint ? "expected no folder_constraint in validation" : null),
    ]
  );

  const readNote = await callTool("read_note", {
    knowledge_base_name: "kb-contracts",
    note_path: "first.md",
    offset: 0,
    limit: 5,
  });
  record(
    "notes",
    "read_note",
    {
      knowledge_base_name: "kb-contracts",
      note_path: "first.md",
      offset: 0,
      limit: 5,
    },
    readNote,
    ["path", "content", "offset", "has_more"],
    [
      (value) => ((value as any).content?.length === 5 ? null : "expected content length 5"),
    ]
  );

  const updatedNote = await callTool("update_note", {
    knowledge_base_name: "kb-contracts",
    note_path: "first.md",
    note_content: "---\ntitle: First\n---\nUpdated",
  });
  record(
    "notes",
    "update_note",
    {
      knowledge_base_name: "kb-contracts",
      note_path: "first.md",
      note_content: "---\ntitle: First\n---\nUpdated",
    },
    updatedNote,
    ["original_note", "updated_note", "validation", "validation_instruction_for_llm"],
    [
      (value) => ((value as any).updated_note?.content?.includes("Updated") ? null : "expected updated content"),
      (value) => ((value as any).validation?.folder_constraint ? null : "expected folder_constraint in validation"),
    ]
  );

  const appendedNote = await callTool("append_note", {
    knowledge_base_name: "kb-contracts",
    note_path: "first.md",
    note_content: "Appended",
  });
  record(
    "notes",
    "append_note",
    {
      knowledge_base_name: "kb-contracts",
      note_path: "first.md",
      note_content: "Appended",
    },
    appendedNote,
    ["original_note", "updated_note", "validation", "validation_instruction_for_llm"],
    [
      (value) => ((value as any).updated_note?.content?.includes("Appended") ? null : "expected appended content"),
      (value) => ((value as any).validation?.folder_constraint ? null : "expected folder_constraint in validation"),
    ]
  );

  const movedNote = await callTool("move_note", {
    knowledge_base_name: "kb-contracts",
    origin_note_path: "first.md",
    new_note_path: "archive/first.md",
  });
  record(
    "notes",
    "move_note",
    {
      knowledge_base_name: "kb-contracts",
      origin_note_path: "first.md",
      new_note_path: "archive/first.md",
    },
    movedNote,
    ["origin_path", "new_path"],
    [
      (value) => ((value as any).new_path === "notes/archive/first.md" ? null : "expected new_path notes/archive/first.md"),
    ]
  );

  const listedNotes = await callTool("list_notes", {
    knowledge_base_name: "kb-contracts",
  });
  record(
    "notes",
    "list_notes",
    { knowledge_base_name: "kb-contracts" },
    listedNotes,
    ["knowledge_base", "notes"],
    [
      (value) => {
        const notes = (value as any).notes;
        if (!Array.isArray(notes)) return "notes is not an array";
        if (!notes.some((note: any) => note.path === "notes/archive/first.md")) {
          return "expected notes to include notes/archive/first.md";
        }
        return null;
      },
    ]
  );

  const deletedNote = await callTool("delete_note", {
    knowledge_base_name: "kb-contracts",
    note_path: "archive/first.md",
  });
  record(
    "notes",
    "delete_note",
    {
      knowledge_base_name: "kb-contracts",
      note_path: "archive/first.md",
    },
    deletedNote,
    ["deleted_path"],
    [
      (value) => ((value as any).deleted_path === "notes/archive/first.md" ? null : "expected deleted_path notes/archive/first.md"),
    ]
  );

  // Vault scope
  const listedFiles = await callTool("list_vault_files", {});
  record(
    "vault",
    "list_vault_files",
    {},
    listedFiles,
    ["files"],
    [
      (value) => {
        const files = (value as any).files;
        if (!Array.isArray(files)) return "files is not an array";
        if (!files.some((file: string) => file === "notes/active.md")) return "expected files to include notes/active.md";
        return null;
      },
    ]
  );

  const searched = await callTool("search_vault", { query: "Search", context_length: 6 });
  record(
    "vault",
    "search_vault",
    { query: "Search", context_length: 6 },
    searched,
    ["results"],
    [
      (value) => {
        const results = (value as any).results;
        if (!Array.isArray(results)) return "results is not an array";
        if (!results.some((result: any) => result.path === "docs/readme.md")) {
          return "expected results to include docs/readme.md";
        }
        return null;
      },
    ]
  );

  const activeNote = await callTool("get_active_note", {});
  record(
    "vault",
    "get_active_note",
    {},
    activeNote,
    ["path", "content"],
    [(value) => ((value as any).path === "notes/active.md" ? null : "expected active note path")]
  );

  // Commands scope
  const listedCommands = await callTool("list_commands", {});
  record(
    "commands",
    "list_commands",
    {},
    listedCommands,
    ["commands"],
    [
      (value) => {
        const commands = (value as any).commands;
        if (!Array.isArray(commands)) return "commands is not an array";
        if (!commands.some((command: any) => command.id === "test-command")) {
          return "expected test-command";
        }
        return null;
      },
    ]
  );

  const executedCommand = await callTool("execute_command", { command_id: "test-command" });
  record(
    "commands",
    "execute_command",
    { command_id: "test-command" },
    executedCommand,
    ["success"],
    [
      (value) => ((value as any).success === true ? null : "expected success true"),
      () => (executed.includes("test-command") ? null : "expected executeCommandById to run"),
    ]
  );

  const failures = results.filter((result) => result.errors.length > 0);
  for (const result of results) {
    printCase(result);
  }

  console.log(`\nTotal: ${results.length} cases, ${failures.length} failures`);
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}
