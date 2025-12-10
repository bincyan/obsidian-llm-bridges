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
  ApiError,
  ConstraintViolationError,
  ValidationResult,
  VALIDATION_INSTRUCTIONS,
  DEFAULT_READ_LIMIT,
} from "./types";

interface LLMBridgesSettings {
  port: number;
  apiKey: string;
}

const DEFAULT_SETTINGS: LLMBridgesSettings = {
  port: 27124,
  apiKey: "",
};

export default class LLMBridgesPlugin extends Plugin {
  settings: LLMBridgesSettings;
  server: http.Server | null = null;
  kbManager: KBManager;

  async onload() {
    await this.loadSettings();
    this.kbManager = new KBManager(this.app);

    // Generate API key if not set
    if (!this.settings.apiKey) {
      this.settings.apiKey = this.generateApiKey();
      await this.saveSettings();
    }

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

    // Start server
    this.startServer();
  }

  onunload() {
    this.stopServer();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  generateApiKey(): string {
    const chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    for (let i = 0; i < 32; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  startServer() {
    if (this.server) {
      this.server.close();
    }

    this.server = http.createServer(async (req, res) => {
      // CORS headers
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

      if (req.method === "OPTIONS") {
        res.writeHead(200);
        res.end();
        return;
      }

      // Auth check
      const authHeader = req.headers.authorization;
      if (authHeader !== `Bearer ${this.settings.apiKey}`) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }

      try {
        await this.handleRequest(req, res);
      } catch (error) {
        console.error("LLM Bridges error:", error);

        // Handle structured errors
        if (this.isApiError(error)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error }));
          return;
        }

        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(error) }));
      }
    });

    this.server.listen(this.settings.port, "127.0.0.1", () => {
      console.log(`LLM Bridges listening on http://127.0.0.1:${this.settings.port}`);
    });

    this.server.on("error", (err) => {
      console.error("LLM Bridges server error:", err);
      new Notice(`LLM Bridges: Server error - ${err.message}`);
    });
  }

  stopServer() {
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

  private isApiError(error: unknown): error is ApiError {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      "message" in error
    );
  }

  async handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url || "/", `http://127.0.0.1:${this.settings.port}`);
    const path = url.pathname;

    // Parse body for POST/PUT requests
    let body = "";
    if (req.method === "POST" || req.method === "PUT") {
      body = await new Promise<string>((resolve) => {
        let data = "";
        req.on("data", (chunk) => (data += chunk));
        req.on("end", () => resolve(data));
      });
    }

    // =========================================================================
    // Status & Legacy Routes
    // =========================================================================

    if (path === "/" && req.method === "GET") {
      return this.handleStatus(res);
    }

    // Legacy vault operations (for backward compatibility)
    if (path === "/vault" && req.method === "GET") {
      return this.handleListFiles(res, url.searchParams.get("path") || "");
    }

    if (path === "/vault/read" && req.method === "POST") {
      const data = JSON.parse(body);
      return this.handleReadFileLegacy(res, data.path);
    }

    if (path === "/vault/write" && req.method === "POST") {
      const data = JSON.parse(body);
      return this.handleWriteFileLegacy(res, data.path, data.content);
    }

    if (path === "/vault/append" && req.method === "POST") {
      const data = JSON.parse(body);
      return this.handleAppendFileLegacy(res, data.path, data.content);
    }

    if (path === "/vault/delete" && req.method === "POST") {
      const data = JSON.parse(body);
      return this.handleDeleteFileLegacy(res, data.path);
    }

    if (path === "/search" && req.method === "POST") {
      const data = JSON.parse(body);
      return this.handleSearch(res, data.query, data.contextLength || 100);
    }

    if (path === "/active" && req.method === "GET") {
      return this.handleGetActive(res);
    }

    if (path === "/commands" && req.method === "GET") {
      return this.handleListCommands(res);
    }

    if (path === "/commands/execute" && req.method === "POST") {
      const data = JSON.parse(body);
      return this.handleExecuteCommand(res, data.commandId);
    }

    // =========================================================================
    // Knowledge Base Routes
    // =========================================================================

    if (path === "/kb" && req.method === "GET") {
      return this.handleListKnowledgeBases(res);
    }

    if (path === "/kb" && req.method === "POST") {
      const data = JSON.parse(body);
      return this.handleAddKnowledgeBase(res, data);
    }

    if (path === "/kb" && req.method === "PUT") {
      const data = JSON.parse(body);
      return this.handleUpdateKnowledgeBase(res, data);
    }

    if (path === "/kb/constraint" && req.method === "POST") {
      const data = JSON.parse(body);
      return this.handleAddFolderConstraint(res, data);
    }

    // =========================================================================
    // Note Routes (KB-scoped with validation)
    // =========================================================================

    if (path === "/kb/notes" && req.method === "GET") {
      const kbName = url.searchParams.get("kb");
      const subfolder = url.searchParams.get("subfolder") || undefined;
      return this.handleListNotes(res, kbName || "", subfolder);
    }

    if (path === "/kb/note/create" && req.method === "POST") {
      const data = JSON.parse(body);
      return this.handleCreateNote(res, data);
    }

    if (path === "/kb/note/read" && req.method === "POST") {
      const data = JSON.parse(body);
      return this.handleReadNote(res, data);
    }

    if (path === "/kb/note/update" && req.method === "POST") {
      const data = JSON.parse(body);
      return this.handleUpdateNote(res, data);
    }

    if (path === "/kb/note/append" && req.method === "POST") {
      const data = JSON.parse(body);
      return this.handleAppendNote(res, data);
    }

    if (path === "/kb/note/move" && req.method === "POST") {
      const data = JSON.parse(body);
      return this.handleMoveNote(res, data);
    }

    if (path === "/kb/note/delete" && req.method === "POST") {
      const data = JSON.parse(body);
      return this.handleDeleteNote(res, data);
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  }

  // ===========================================================================
  // Status & Legacy Handlers
  // ===========================================================================

  handleStatus(res: http.ServerResponse) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        version: this.manifest.version,
        vault: this.app.vault.getName(),
      })
    );
  }

  handleListFiles(res: http.ServerResponse, folderPath: string) {
    const files: string[] = [];

    const listRecursive = (folder: TFolder, prefix: string) => {
      for (const child of folder.children) {
        const childPath = prefix ? `${prefix}/${child.name}` : child.name;
        if (child instanceof TFile) {
          files.push(childPath);
        } else if (child instanceof TFolder) {
          files.push(childPath + "/");
        }
      }
    };

    if (folderPath) {
      const folder = this.app.vault.getAbstractFileByPath(folderPath);
      if (folder instanceof TFolder) {
        listRecursive(folder, "");
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Folder not found" }));
        return;
      }
    } else {
      listRecursive(this.app.vault.getRoot(), "");
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ files }));
  }

  async handleReadFileLegacy(res: http.ServerResponse, filePath: string) {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "File not found" }));
      return;
    }

    const content = await this.app.vault.read(file);
    const cache = this.app.metadataCache.getFileCache(file);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        path: file.path,
        content,
        frontmatter: cache?.frontmatter || {},
        tags: cache?.tags?.map((t) => t.tag) || [],
        stat: file.stat,
      })
    );
  }

  async handleWriteFileLegacy(
    res: http.ServerResponse,
    filePath: string,
    content: string
  ) {
    // Create parent folders if needed
    const folderPath = filePath.substring(0, filePath.lastIndexOf("/"));
    if (folderPath) {
      const folder = this.app.vault.getAbstractFileByPath(folderPath);
      if (!folder) {
        await this.app.vault.createFolder(folderPath);
      }
    }

    const existingFile = this.app.vault.getAbstractFileByPath(filePath);
    if (existingFile instanceof TFile) {
      await this.app.vault.modify(existingFile, content);
    } else {
      await this.app.vault.create(filePath, content);
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, path: filePath }));
  }

  async handleAppendFileLegacy(
    res: http.ServerResponse,
    filePath: string,
    content: string
  ) {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
      return this.handleWriteFileLegacy(res, filePath, content);
    }

    const existingContent = await this.app.vault.read(file);
    const newContent = existingContent.endsWith("\n")
      ? existingContent + content
      : existingContent + "\n" + content;

    await this.app.vault.modify(file, newContent);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, path: filePath }));
  }

  async handleDeleteFileLegacy(res: http.ServerResponse, filePath: string) {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "File not found" }));
      return;
    }

    await this.app.vault.delete(file);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true }));
  }

  async handleSearch(
    res: http.ServerResponse,
    query: string,
    contextLength: number
  ) {
    const results: Array<{
      path: string;
      matches: Array<{ context: string; start: number; end: number }>;
    }> = [];

    const search = prepareSimpleSearch(query);

    for (const file of this.app.vault.getMarkdownFiles()) {
      const content = await this.app.vault.cachedRead(file);
      const result = search(content);

      if (result) {
        const matches = result.matches.map((match) => ({
          start: match[0],
          end: match[1],
          context: content.slice(
            Math.max(0, match[0] - contextLength),
            match[1] + contextLength
          ),
        }));

        results.push({
          path: file.path,
          matches,
        });
      }
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ results }));
  }

  handleGetActive(res: http.ServerResponse) {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No active file" }));
      return;
    }

    this.handleReadFileLegacy(res, file.path);
  }

  handleListCommands(res: http.ServerResponse) {
    const commands = Object.values(this.app.commands.commands).map((cmd) => ({
      id: cmd.id,
      name: cmd.name,
    }));

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ commands }));
  }

  handleExecuteCommand(res: http.ServerResponse, commandId: string) {
    const cmd = this.app.commands.commands[commandId];
    if (!cmd) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Command not found" }));
      return;
    }

    this.app.commands.executeCommandById(commandId);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true }));
  }

  // ===========================================================================
  // Knowledge Base Handlers
  // ===========================================================================

  async handleListKnowledgeBases(res: http.ServerResponse) {
    const kbs = await this.kbManager.listKnowledgeBases();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ knowledge_bases: kbs }));
  }

  async handleAddKnowledgeBase(
    res: http.ServerResponse,
    data: {
      name: string;
      description: string;
      subfolder: string;
      organization_rules: string;
    }
  ) {
    const kb = await this.kbManager.addKnowledgeBase(
      data.name,
      data.description,
      data.subfolder,
      data.organization_rules
    );

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        knowledge_base: kb,
        next_steps:
          "Knowledge base created. Please define folder constraints using add_knowledge_base_folder_constraint to specify machine-checkable metadata rules for notes under specific subfolders.",
      })
    );
  }

  async handleUpdateKnowledgeBase(
    res: http.ServerResponse,
    data: {
      name: string;
      description?: string;
      subfolder?: string;
      organization_rules?: string;
    }
  ) {
    const kb = await this.kbManager.updateKnowledgeBase(data.name, {
      description: data.description,
      subfolder: data.subfolder,
      organization_rules: data.organization_rules,
    });

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ knowledge_base: kb }));
  }

  async handleAddFolderConstraint(
    res: http.ServerResponse,
    data: {
      kb_name: string;
      subfolder: string;
      rules: ConstraintRules;
    }
  ) {
    // Validate rules schema
    const schemaValidation = validateConstraintRulesSchema(data.rules);
    if (!schemaValidation.passed) {
      const error: ApiError = {
        code: "schema_validation_failed",
        message: "Invalid constraint rules schema",
        details: schemaValidation.issues,
      };
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error }));
      return;
    }

    const constraint = await this.kbManager.addFolderConstraint(
      data.kb_name,
      data.subfolder,
      data.rules
    );

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ folder_constraint: constraint }));
  }

  // ===========================================================================
  // Note Handlers (KB-scoped with validation)
  // ===========================================================================

  async handleListNotes(
    res: http.ServerResponse,
    kbName: string,
    subfolder?: string
  ) {
    const kb = await this.kbManager.getKnowledgeBase(kbName);
    if (!kb) {
      const error: ApiError = {
        code: "knowledge_base_not_found",
        message: `Knowledge base '${kbName}' not found`,
      };
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error }));
      return;
    }

    const searchPath = subfolder
      ? this.kbManager.resolveNotePath(kb, subfolder)
      : kb.subfolder;

    const notes: { path: string }[] = [];
    const collectNotes = (folder: TFolder) => {
      for (const child of folder.children) {
        if (child instanceof TFile && child.extension === "md") {
          notes.push({ path: child.path });
        } else if (child instanceof TFolder) {
          collectNotes(child);
        }
      }
    };

    const folder = this.app.vault.getAbstractFileByPath(searchPath);
    if (folder instanceof TFolder) {
      collectNotes(folder);
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        knowledge_base: { name: kb.name, subfolder: kb.subfolder },
        notes,
      })
    );
  }

  async handleCreateNote(
    res: http.ServerResponse,
    data: {
      knowledge_base_name: string;
      note_path: string;
      note_content: string;
    }
  ) {
    const kb = await this.kbManager.getKnowledgeBase(data.knowledge_base_name);
    if (!kb) {
      const error: ApiError = {
        code: "knowledge_base_not_found",
        message: `Knowledge base '${data.knowledge_base_name}' not found`,
      };
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error }));
      return;
    }

    // Resolve path
    const resolvedPath = this.kbManager.resolveNotePath(kb, data.note_path);

    // Check if note already exists
    if (this.kbManager.noteExists(resolvedPath)) {
      const error: ApiError = {
        code: "note_already_exists",
        message: `Note already exists at '${resolvedPath}'`,
      };
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error }));
      return;
    }

    // Get applicable constraints and validate
    const constraints = await this.kbManager.getFolderConstraints(kb.name);
    const constraint = findApplicableConstraint(resolvedPath, constraints);

    let validation: ValidationResult = { passed: true, issues: [] };
    if (constraint) {
      validation = validateNote(resolvedPath, data.note_content, constraint);
      if (!validation.passed) {
        const error: ConstraintViolationError = {
          code: "folder_constraint_violation",
          message: "Note does not satisfy folder constraint requirements",
          constraint: {
            kb_name: constraint.kb_name,
            subfolder: constraint.subfolder,
          },
          issues: validation.issues,
        };
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error }));
        return;
      }
    }

    // Create parent folders if needed
    const folderPath = resolvedPath.substring(0, resolvedPath.lastIndexOf("/"));
    if (folderPath) {
      await this.ensureFolder(folderPath);
    }

    // Create the note
    await this.app.vault.create(resolvedPath, data.note_content);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        knowledge_base: kb,
        note: {
          path: resolvedPath,
          content: data.note_content,
        },
        machine_validation: validation,
        validation_instruction_for_llm: VALIDATION_INSTRUCTIONS.create_note,
      })
    );
  }

  async handleReadNote(
    res: http.ServerResponse,
    data: {
      knowledge_base_name: string;
      note_path: string;
      offset?: number;
      limit?: number;
    }
  ) {
    const kb = await this.kbManager.getKnowledgeBase(data.knowledge_base_name);
    if (!kb) {
      const error: ApiError = {
        code: "knowledge_base_not_found",
        message: `Knowledge base '${data.knowledge_base_name}' not found`,
      };
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error }));
      return;
    }

    // Resolve path
    const resolvedPath = this.kbManager.resolveNotePath(kb, data.note_path);

    const file = this.app.vault.getAbstractFileByPath(resolvedPath);
    if (!(file instanceof TFile)) {
      const error: ApiError = {
        code: "note_not_found",
        message: `Note not found at '${resolvedPath}'`,
      };
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error }));
      return;
    }

    const fullContent = await this.app.vault.read(file);
    const offset = data.offset || 0;
    const limit = data.limit || DEFAULT_READ_LIMIT;

    const chunk = fullContent.slice(offset, offset + limit);
    const hasMore = offset + limit < fullContent.length;
    const remainingChars = Math.max(0, fullContent.length - (offset + limit));

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        knowledge_base: kb,
        note: {
          path: resolvedPath,
          content: chunk,
          offset,
          next_offset: offset + chunk.length,
          has_more: hasMore,
          remaining_chars: remainingChars,
        },
      })
    );
  }

  async handleUpdateNote(
    res: http.ServerResponse,
    data: {
      knowledge_base_name: string;
      note_path: string;
      note_content: string;
    }
  ) {
    const kb = await this.kbManager.getKnowledgeBase(data.knowledge_base_name);
    if (!kb) {
      const error: ApiError = {
        code: "knowledge_base_not_found",
        message: `Knowledge base '${data.knowledge_base_name}' not found`,
      };
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error }));
      return;
    }

    // Resolve path
    const resolvedPath = this.kbManager.resolveNotePath(kb, data.note_path);

    const file = this.app.vault.getAbstractFileByPath(resolvedPath);
    if (!(file instanceof TFile)) {
      const error: ApiError = {
        code: "note_not_found",
        message: `Note not found at '${resolvedPath}'`,
      };
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error }));
      return;
    }

    // Read original content
    const originalContent = await this.app.vault.read(file);

    // Get applicable constraints and validate new content
    const constraints = await this.kbManager.getFolderConstraints(kb.name);
    const constraint = findApplicableConstraint(resolvedPath, constraints);

    let validation: ValidationResult = { passed: true, issues: [] };
    if (constraint) {
      validation = validateNote(resolvedPath, data.note_content, constraint);
      if (!validation.passed) {
        const error: ConstraintViolationError = {
          code: "folder_constraint_violation",
          message: "Note does not satisfy folder constraint requirements",
          constraint: {
            kb_name: constraint.kb_name,
            subfolder: constraint.subfolder,
          },
          issues: validation.issues,
        };
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error }));
        return;
      }
    }

    // Update the note
    await this.app.vault.modify(file, data.note_content);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        knowledge_base: kb,
        original_note: {
          path: resolvedPath,
          content: originalContent,
        },
        updated_note: {
          path: resolvedPath,
          content: data.note_content,
        },
        machine_validation: validation,
        validation_instruction_for_llm: VALIDATION_INSTRUCTIONS.update_note,
      })
    );
  }

  async handleAppendNote(
    res: http.ServerResponse,
    data: {
      knowledge_base_name: string;
      note_path: string;
      note_content: string;
    }
  ) {
    const kb = await this.kbManager.getKnowledgeBase(data.knowledge_base_name);
    if (!kb) {
      const error: ApiError = {
        code: "knowledge_base_not_found",
        message: `Knowledge base '${data.knowledge_base_name}' not found`,
      };
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error }));
      return;
    }

    // Resolve path
    const resolvedPath = this.kbManager.resolveNotePath(kb, data.note_path);

    const file = this.app.vault.getAbstractFileByPath(resolvedPath);
    if (!(file instanceof TFile)) {
      const error: ApiError = {
        code: "note_not_found",
        message: `Note not found at '${resolvedPath}'`,
      };
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error }));
      return;
    }

    // Read original content
    const originalContent = await this.app.vault.read(file);

    // Construct new content
    const newContent = originalContent.endsWith("\n")
      ? originalContent + data.note_content
      : originalContent + "\n" + data.note_content;

    // Get applicable constraints and validate combined content
    const constraints = await this.kbManager.getFolderConstraints(kb.name);
    const constraint = findApplicableConstraint(resolvedPath, constraints);

    let validation: ValidationResult = { passed: true, issues: [] };
    if (constraint) {
      validation = validateNote(resolvedPath, newContent, constraint);
      if (!validation.passed) {
        const error: ConstraintViolationError = {
          code: "folder_constraint_violation",
          message: "Note does not satisfy folder constraint requirements",
          constraint: {
            kb_name: constraint.kb_name,
            subfolder: constraint.subfolder,
          },
          issues: validation.issues,
        };
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error }));
        return;
      }
    }

    // Update the note
    await this.app.vault.modify(file, newContent);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        knowledge_base: kb,
        original_note: {
          path: resolvedPath,
          content: originalContent,
        },
        updated_note: {
          path: resolvedPath,
          content: newContent,
        },
        machine_validation: validation,
        validation_instruction_for_llm: VALIDATION_INSTRUCTIONS.append_note,
      })
    );
  }

  async handleMoveNote(
    res: http.ServerResponse,
    data: {
      knowledge_base_name: string;
      origin_note_path: string;
      new_note_path: string;
    }
  ) {
    const kb = await this.kbManager.getKnowledgeBase(data.knowledge_base_name);
    if (!kb) {
      const error: ApiError = {
        code: "knowledge_base_not_found",
        message: `Knowledge base '${data.knowledge_base_name}' not found`,
      };
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error }));
      return;
    }

    // Resolve paths
    const originPath = this.kbManager.resolveNotePath(kb, data.origin_note_path);
    const newPath = this.kbManager.resolveNotePath(kb, data.new_note_path);

    // Check origin exists
    const originFile = this.app.vault.getAbstractFileByPath(originPath);
    if (!(originFile instanceof TFile)) {
      const error: ApiError = {
        code: "note_not_found",
        message: `Note not found at '${originPath}'`,
      };
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error }));
      return;
    }

    // Check destination doesn't exist
    if (this.kbManager.noteExists(newPath)) {
      const error: ApiError = {
        code: "note_already_exists",
        message: `Note already exists at '${newPath}'`,
      };
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error }));
      return;
    }

    // Read content to validate against new path's constraints
    const content = await this.app.vault.read(originFile);

    // Get applicable constraints for new path and validate
    const constraints = await this.kbManager.getFolderConstraints(kb.name);
    const constraint = findApplicableConstraint(newPath, constraints);

    let validation: ValidationResult = { passed: true, issues: [] };
    if (constraint) {
      validation = validateNote(newPath, content, constraint);
      if (!validation.passed) {
        const error: ConstraintViolationError = {
          code: "folder_constraint_violation",
          message: "Note does not satisfy folder constraint requirements for new location",
          constraint: {
            kb_name: constraint.kb_name,
            subfolder: constraint.subfolder,
          },
          issues: validation.issues,
        };
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error }));
        return;
      }
    }

    // Create parent folders for new path if needed
    const newFolderPath = newPath.substring(0, newPath.lastIndexOf("/"));
    if (newFolderPath) {
      await this.ensureFolder(newFolderPath);
    }

    // Move the file
    await this.app.vault.rename(originFile, newPath);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        knowledge_base: kb,
        origin_path: originPath,
        new_path: newPath,
        machine_validation: validation,
        validation_instruction_for_llm: VALIDATION_INSTRUCTIONS.move_note,
      })
    );
  }

  async handleDeleteNote(
    res: http.ServerResponse,
    data: {
      knowledge_base_name: string;
      note_path: string;
    }
  ) {
    const kb = await this.kbManager.getKnowledgeBase(data.knowledge_base_name);
    if (!kb) {
      const error: ApiError = {
        code: "knowledge_base_not_found",
        message: `Knowledge base '${data.knowledge_base_name}' not found`,
      };
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error }));
      return;
    }

    // Resolve path
    const resolvedPath = this.kbManager.resolveNotePath(kb, data.note_path);

    const file = this.app.vault.getAbstractFileByPath(resolvedPath);
    if (!(file instanceof TFile)) {
      const error: ApiError = {
        code: "note_not_found",
        message: `Note not found at '${resolvedPath}'`,
      };
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error }));
      return;
    }

    await this.app.vault.delete(file);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        knowledge_base: { name: kb.name, subfolder: kb.subfolder },
        deleted_path: resolvedPath,
      })
    );
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
    const config = {
      mcpServers: {
        obsidian: {
          command: "npx",
          args: ["-y", "obsidian-llm-bridges"],
          env: {
            OBSIDIAN_API_URL: `http://127.0.0.1:${this.settings.port}`,
            OBSIDIAN_API_KEY: this.settings.apiKey,
          },
        },
      },
    };

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
      text: `Server running on http://127.0.0.1:${this.plugin.settings.port}`,
    });

    // API Key display
    new Setting(containerEl)
      .setName("API Key")
      .setDesc("Used to authenticate requests to the server")
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

    new Setting(containerEl)
      .setName("Port")
      .setDesc("Port for the HTTP server (requires restart)")
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
      .setDesc("Apply port changes")
      .addButton((btn) =>
        btn.setButtonText("Restart").onClick(() => {
          this.plugin.restartServer();
        })
      );

    // Claude Setup
    containerEl.createEl("h3", { text: "Claude Setup" });

    const instructionsEl = containerEl.createEl("div");
    instructionsEl.createEl("p", {
      text: "Add this to your Claude Desktop configuration:",
    });

    const configEl = containerEl.createEl("pre", {
      cls: "llm-bridges-config",
    });
    configEl.setText(`{
  "mcpServers": {
    "obsidian": {
      "command": "npx",
      "args": ["-y", "obsidian-llm-bridges"],
      "env": {
        "OBSIDIAN_API_URL": "http://127.0.0.1:${this.plugin.settings.port}",
        "OBSIDIAN_API_KEY": "${this.plugin.settings.apiKey}"
      }
    }
  }
}`);

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
  }
}
