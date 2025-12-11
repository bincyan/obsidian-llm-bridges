/**
 * Mock Obsidian API for testing
 * Provides comprehensive stubs for Obsidian types and classes
 * Supports Level 2 testing - Fake Obsidian environment
 */

// Mock TFile
export class TFile {
  path: string;
  name: string;
  extension: string;
  basename: string;
  parent: TFolder | null;

  constructor(path: string) {
    this.path = path;
    this.name = path.split('/').pop() || '';
    this.extension = this.name.split('.').pop() || '';
    this.basename = this.name.replace(/\.[^.]+$/, '');
    this.parent = null;
  }
}

// Mock TFolder
export class TFolder {
  path: string;
  name: string;
  children: (TFile | TFolder)[];
  parent: TFolder | null;

  constructor(path: string) {
    this.path = path;
    this.name = path.split('/').pop() || '';
    this.children = [];
    this.parent = null;
  }

  isRoot(): boolean {
    return this.path === '' || this.path === '/';
  }
}

// Mock TAbstractFile
export type TAbstractFile = TFile | TFolder;

/**
 * Enhanced Mock Vault with full file system simulation
 * Supports hierarchical folder structure with children
 */
export class Vault {
  private files: Map<string, string> = new Map();
  private folderObjects: Map<string, TFolder> = new Map();

  // ============================================================================
  // Test Helpers
  // ============================================================================

  /**
   * Set a file in the mock vault (for test setup)
   */
  _setFile(path: string, content: string): void {
    this.files.set(path, content);
    this._ensureFolderHierarchy(path);
  }

  /**
   * Add a folder to the mock vault (for test setup)
   */
  _addFolder(path: string): TFolder {
    if (this.folderObjects.has(path)) {
      return this.folderObjects.get(path)!;
    }

    const folder = new TFolder(path);
    this.folderObjects.set(path, folder);

    // Ensure parent folders exist and link them
    const parentPath = this._getParentPath(path);
    if (parentPath !== null && parentPath !== path) {
      const parentFolder = this._addFolder(parentPath);
      folder.parent = parentFolder;
      if (!parentFolder.children.some((c) => c.path === path)) {
        parentFolder.children.push(folder);
      }
    }

    return folder;
  }

  /**
   * Clear all files and folders (for test cleanup)
   */
  _clear(): void {
    this.files.clear();
    this.folderObjects.clear();
  }

  /**
   * Get all file paths (for debugging)
   */
  _getAllPaths(): string[] {
    return Array.from(this.files.keys());
  }

  /**
   * Get all folder paths (for debugging)
   */
  _getAllFolders(): string[] {
    return Array.from(this.folderObjects.keys());
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private _getParentPath(path: string): string | null {
    const parts = path.split('/');
    if (parts.length <= 1) return null;
    return parts.slice(0, -1).join('/');
  }

  private _ensureFolderHierarchy(filePath: string): void {
    const parts = filePath.split('/');
    // Create all parent folders
    for (let i = 1; i < parts.length; i++) {
      const folderPath = parts.slice(0, i).join('/');
      this._addFolder(folderPath);
    }

    // Add file to its parent folder's children
    const parentPath = this._getParentPath(filePath);
    if (parentPath) {
      const parentFolder = this.folderObjects.get(parentPath);
      if (parentFolder) {
        const file = new TFile(filePath);
        file.parent = parentFolder;
        // Replace existing file reference or add new one
        const existingIndex = parentFolder.children.findIndex((c) => c.path === filePath);
        if (existingIndex >= 0) {
          parentFolder.children[existingIndex] = file;
        } else {
          parentFolder.children.push(file);
        }
      }
    }
  }

  private _removeFromParent(path: string): void {
    const parentPath = this._getParentPath(path);
    if (parentPath) {
      const parentFolder = this.folderObjects.get(parentPath);
      if (parentFolder) {
        parentFolder.children = parentFolder.children.filter((c) => c.path !== path);
      }
    }
  }

  // ============================================================================
  // Vault API Implementation
  // ============================================================================

  async read(file: TFile): Promise<string> {
    const content = this.files.get(file.path);
    if (content === undefined) {
      throw new Error(`File not found: ${file.path}`);
    }
    return content;
  }

  async create(path: string, content: string): Promise<TFile> {
    if (this.files.has(path)) {
      throw new Error(`File already exists: ${path}`);
    }
    this.files.set(path, content);
    this._ensureFolderHierarchy(path);
    return new TFile(path);
  }

  async modify(file: TFile, content: string): Promise<void> {
    if (!this.files.has(file.path)) {
      throw new Error(`File not found: ${file.path}`);
    }
    this.files.set(file.path, content);
  }

  async delete(file: TFile | TFolder, force?: boolean): Promise<void> {
    if (file instanceof TFile) {
      if (!this.files.has(file.path)) {
        throw new Error(`File not found: ${file.path}`);
      }
      this.files.delete(file.path);
      this._removeFromParent(file.path);
    } else {
      // Delete folder and all contents
      const prefix = file.path + '/';
      for (const path of this.files.keys()) {
        if (path.startsWith(prefix)) {
          this.files.delete(path);
        }
      }
      for (const path of this.folderObjects.keys()) {
        if (path.startsWith(prefix) || path === file.path) {
          this.folderObjects.delete(path);
        }
      }
      this._removeFromParent(file.path);
    }
  }

  async rename(file: TFile, newPath: string): Promise<void> {
    const content = this.files.get(file.path);
    if (content === undefined) {
      throw new Error(`File not found: ${file.path}`);
    }
    this._removeFromParent(file.path);
    this.files.delete(file.path);
    this.files.set(newPath, content);
    this._ensureFolderHierarchy(newPath);
    file.path = newPath;
    file.name = newPath.split('/').pop() || '';
  }

  async createFolder(path: string): Promise<TFolder> {
    return this._addFolder(path);
  }

  getAbstractFileByPath(path: string): TAbstractFile | null {
    if (this.files.has(path)) {
      const file = new TFile(path);
      const parentPath = this._getParentPath(path);
      if (parentPath) {
        file.parent = this.folderObjects.get(parentPath) || null;
      }
      return file;
    }
    if (this.folderObjects.has(path)) {
      return this.folderObjects.get(path)!;
    }
    return null;
  }

  getFiles(): TFile[] {
    return Array.from(this.files.keys()).map((path) => {
      const file = new TFile(path);
      const parentPath = this._getParentPath(path);
      if (parentPath) {
        file.parent = this.folderObjects.get(parentPath) || null;
      }
      return file;
    });
  }

  getAllLoadedFiles(): TAbstractFile[] {
    const files = this.getFiles();
    const folders = Array.from(this.folderObjects.values());
    return [...files, ...folders];
  }

  /**
   * Check if a file or folder exists
   */
  exists(path: string): boolean {
    return this.files.has(path) || this.folderObjects.has(path);
  }
}

// Mock App
export class App {
  vault: Vault;

  constructor() {
    this.vault = new Vault();
  }
}

// Mock Notice
export class Notice {
  constructor(_message: string, _timeout?: number) {
    // No-op in tests
  }
}

// Mock Plugin
export class Plugin {
  app: App;
  manifest: PluginManifest;

  constructor(app: App, manifest: PluginManifest) {
    this.app = app;
    this.manifest = manifest;
  }

  async loadData(): Promise<unknown> {
    return {};
  }

  async saveData(_data: unknown): Promise<void> {
    // No-op in tests
  }

  addCommand(_command: Command): Command {
    return _command;
  }

  addSettingTab(_tab: PluginSettingTab): void {
    // No-op in tests
  }

  registerInterval(_id: number): number {
    return _id;
  }
}

// Mock PluginManifest
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  minAppVersion: string;
  description: string;
  author: string;
  authorUrl?: string;
  isDesktopOnly?: boolean;
}

// Mock Command
export interface Command {
  id: string;
  name: string;
  callback?: () => void;
  checkCallback?: (checking: boolean) => boolean | void;
}

// Mock PluginSettingTab
export class PluginSettingTab {
  app: App;
  plugin: Plugin;

  constructor(app: App, plugin: Plugin) {
    this.app = app;
    this.plugin = plugin;
  }

  display(): void {
    // No-op in tests
  }

  hide(): void {
    // No-op in tests
  }
}

// Mock Setting
export class Setting {
  constructor(_containerEl: HTMLElement) {
    // No-op in tests
  }

  setName(_name: string): this {
    return this;
  }

  setDesc(_desc: string): this {
    return this;
  }

  addText(_cb: (text: TextComponent) => void): this {
    return this;
  }

  addToggle(_cb: (toggle: ToggleComponent) => void): this {
    return this;
  }

  addButton(_cb: (button: ButtonComponent) => void): this {
    return this;
  }
}

// Mock components
export interface TextComponent {
  setValue(value: string): this;
  onChange(cb: (value: string) => void): this;
}

export interface ToggleComponent {
  setValue(value: boolean): this;
  onChange(cb: (value: boolean) => void): this;
}

export interface ButtonComponent {
  setButtonText(text: string): this;
  onClick(cb: () => void): this;
}

// Export default mock app for convenience
export function createMockApp(): App {
  return new App();
}

/**
 * Helper to set up a mock vault with pre-populated KB structure
 */
export function createMockVaultWithKB(
  kbName: string,
  subfolder: string,
  organizationRules: string = 'Default rules'
): App {
  const app = new App();
  const vault = app.vault;

  // Create KB meta file
  const metaPath = `.llm_bridges/knowledge_base/${kbName}/meta.md`;
  const metaContent = `---
name: "${kbName}"
create_time: "${new Date().toISOString()}"
description: "Test knowledge base"
subfolder: "${subfolder}"
---

# Organization Rules

${organizationRules}`;

  vault._setFile(metaPath, metaContent);

  // Create folder_constraints directory
  vault._addFolder(`.llm_bridges/knowledge_base/${kbName}/folder_constraints`);

  // Create the KB subfolder
  vault._addFolder(subfolder);

  return app;
}
