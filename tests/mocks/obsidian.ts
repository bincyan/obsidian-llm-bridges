/**
 * Mock Obsidian API for testing
 * Provides minimal stubs for Obsidian types and classes
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
    return this.path === '/';
  }
}

// Mock TAbstractFile
export type TAbstractFile = TFile | TFolder;

// Mock Vault
export class Vault {
  private files: Map<string, string> = new Map();
  private folders: Set<string> = new Set();

  // Test helpers
  _setFile(path: string, content: string): void {
    this.files.set(path, content);
    // Ensure parent folders exist
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) {
      this.folders.add(parts.slice(0, i).join('/'));
    }
  }

  _clear(): void {
    this.files.clear();
    this.folders.clear();
  }

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
    return new TFile(path);
  }

  async modify(file: TFile, content: string): Promise<void> {
    if (!this.files.has(file.path)) {
      throw new Error(`File not found: ${file.path}`);
    }
    this.files.set(file.path, content);
  }

  async delete(file: TFile): Promise<void> {
    if (!this.files.has(file.path)) {
      throw new Error(`File not found: ${file.path}`);
    }
    this.files.delete(file.path);
  }

  async rename(file: TFile, newPath: string): Promise<void> {
    const content = this.files.get(file.path);
    if (content === undefined) {
      throw new Error(`File not found: ${file.path}`);
    }
    this.files.delete(file.path);
    this.files.set(newPath, content);
    file.path = newPath;
    file.name = newPath.split('/').pop() || '';
  }

  async createFolder(path: string): Promise<void> {
    this.folders.add(path);
  }

  getAbstractFileByPath(path: string): TAbstractFile | null {
    if (this.files.has(path)) {
      return new TFile(path);
    }
    if (this.folders.has(path)) {
      return new TFolder(path);
    }
    return null;
  }

  getFiles(): TFile[] {
    return Array.from(this.files.keys()).map((path) => new TFile(path));
  }

  getAllLoadedFiles(): TAbstractFile[] {
    const files = Array.from(this.files.keys()).map((path) => new TFile(path));
    const folders = Array.from(this.folders).map((path) => new TFolder(path));
    return [...files, ...folders];
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
