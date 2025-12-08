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

  async onload() {
    await this.loadSettings();

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

    // Route handling
    if (path === "/" && req.method === "GET") {
      return this.handleStatus(res);
    }

    if (path === "/vault" && req.method === "GET") {
      return this.handleListFiles(res, url.searchParams.get("path") || "");
    }

    if (path === "/vault/read" && req.method === "POST") {
      const data = JSON.parse(body);
      return this.handleReadFile(res, data.path);
    }

    if (path === "/vault/write" && req.method === "POST") {
      const data = JSON.parse(body);
      return this.handleWriteFile(res, data.path, data.content);
    }

    if (path === "/vault/append" && req.method === "POST") {
      const data = JSON.parse(body);
      return this.handleAppendFile(res, data.path, data.content);
    }

    if (path === "/vault/delete" && req.method === "POST") {
      const data = JSON.parse(body);
      return this.handleDeleteFile(res, data.path);
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

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  }

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
          // Only recurse one level for directory listings
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

  async handleReadFile(res: http.ServerResponse, filePath: string) {
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

  async handleWriteFile(
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

  async handleAppendFile(
    res: http.ServerResponse,
    filePath: string,
    content: string
  ) {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
      // Create new file if doesn't exist
      return this.handleWriteFile(res, filePath, content);
    }

    const existingContent = await this.app.vault.read(file);
    const newContent = existingContent.endsWith("\n")
      ? existingContent + content
      : existingContent + "\n" + content;

    await this.app.vault.modify(file, newContent);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, path: filePath }));
  }

  async handleDeleteFile(res: http.ServerResponse, filePath: string) {
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

    this.handleReadFile(res, file.path);
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
