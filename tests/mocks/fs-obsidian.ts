/**
 * Filesystem-backed Mock Obsidian API for integration testing
 * Provides real filesystem operations to validate file behavior
 * Test-only implementation - production code remains unchanged
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';

// Import and re-export TFile, TFolder, and TAbstractFile from the in-memory mock for compatibility
import { TFile, TFolder, TAbstractFile as TAbstractFileBase } from './obsidian';
export { TFile, TFolder, TAbstractFile, App as BaseApp } from './obsidian';

type TAbstractFile = TFile | TFolder;

/**
 * Filesystem-backed Vault implementation
 * Uses a temporary directory for actual file operations
 */
export class FsVault {
  private rootDir: string;

  constructor(rootDir?: string) {
    // Create a unique temp directory for this vault instance
    this.rootDir = rootDir || fs.mkdtempSync(path.join(tmpdir(), 'obsidian-vault-'));

    // Ensure root directory exists
    if (!fs.existsSync(this.rootDir)) {
      fs.mkdirSync(this.rootDir, { recursive: true });
    }
  }

  /**
   * Get the root directory path (for testing/debugging)
   */
  getRootDir(): string {
    return this.rootDir;
  }

  /**
   * Cleanup - remove the temporary vault directory
   */
  cleanup(): void {
    if (fs.existsSync(this.rootDir)) {
      fs.rmSync(this.rootDir, { recursive: true, force: true });
    }
  }

  /**
   * Get the full filesystem path for a vault path
   */
  private getFullPath(vaultPath: string): string {
    return path.join(this.rootDir, vaultPath);
  }

  /**
   * Read file contents
   */
  async read(file: { path: string }): Promise<string> {
    const fullPath = this.getFullPath(file.path);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${file.path}`);
    }

    try {
      return fs.readFileSync(fullPath, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to read file ${file.path}: ${error}`);
    }
  }

  /**
   * Create a new file
   */
  async create(filePath: string, content: string): Promise<TFile> {
    const fullPath = this.getFullPath(filePath);

    if (fs.existsSync(fullPath)) {
      throw new Error(`File already exists: ${filePath}`);
    }

    // Ensure parent directory exists
    const parentDir = path.dirname(fullPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    try {
      fs.writeFileSync(fullPath, content, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to create file ${filePath}: ${error}`);
    }

    return new TFile(filePath);
  }

  /**
   * Modify existing file
   */
  async modify(file: { path: string }, content: string): Promise<void> {
    const fullPath = this.getFullPath(file.path);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${file.path}`);
    }

    try {
      fs.writeFileSync(fullPath, content, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to modify file ${file.path}: ${error}`);
    }
  }

  /**
   * Delete a file or folder
   */
  async delete(fileOrFolder: { path: string }, force?: boolean): Promise<void> {
    const fullPath = this.getFullPath(fileOrFolder.path);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${fileOrFolder.path}`);
    }

    try {
      const stats = fs.statSync(fullPath);
      if (stats.isDirectory()) {
        fs.rmSync(fullPath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(fullPath);
      }
    } catch (error) {
      throw new Error(`Failed to delete ${fileOrFolder.path}: ${error}`);
    }
  }

  /**
   * Rename/move a file
   */
  async rename(file: { path: string }, newPath: string): Promise<void> {
    const oldFullPath = this.getFullPath(file.path);
    const newFullPath = this.getFullPath(newPath);

    if (!fs.existsSync(oldFullPath)) {
      throw new Error(`File not found: ${file.path}`);
    }

    // Ensure parent directory exists for new path
    const parentDir = path.dirname(newFullPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    try {
      fs.renameSync(oldFullPath, newFullPath);
      // Update the file object's path
      file.path = newPath;
    } catch (error) {
      throw new Error(`Failed to rename ${file.path} to ${newPath}: ${error}`);
    }
  }

  /**
   * Create a folder
   */
  async createFolder(folderPath: string): Promise<TFolder> {
    const fullPath = this.getFullPath(folderPath);

    try {
      fs.mkdirSync(fullPath, { recursive: true });
    } catch (error) {
      throw new Error(`Failed to create folder ${folderPath}: ${error}`);
    }

    return new TFolder(folderPath);
  }

  /**
   * Get a file or folder by path
   */
  getAbstractFileByPath(filePath: string): TAbstractFile | null {
    const fullPath = this.getFullPath(filePath);

    if (!fs.existsSync(fullPath)) {
      return null;
    }

    const stats = fs.statSync(fullPath);

    if (stats.isDirectory()) {
      const folder = new TFolder(filePath);

      // Populate children for this folder
      try {
        const items = fs.readdirSync(fullPath);
        folder.children = items.map(item => {
          const itemPath = filePath ? `${filePath}/${item}` : item;
          const itemFullPath = this.getFullPath(itemPath);
          const itemStats = fs.statSync(itemFullPath);

          if (itemStats.isDirectory()) {
            return new TFolder(itemPath);
          } else {
            return new TFile(itemPath);
          }
        });
      } catch (error) {
        folder.children = [];
      }

      return folder;
    } else {
      return new TFile(filePath);
    }
  }

  /**
   * Get all files in the vault
   */
  getFiles(): TFile[] {
    const files: TFile[] = [];

    const scanDir = (dir: string, relativeBase: string = '') => {
      const items = fs.readdirSync(path.join(this.rootDir, dir));

      for (const item of items) {
        const relativePath = relativeBase ? `${relativeBase}/${item}` : item;
        const fullPath = this.getFullPath(relativePath);
        const stats = fs.statSync(fullPath);

        if (stats.isFile()) {
          files.push(new TFile(relativePath));
        } else if (stats.isDirectory()) {
          scanDir(relativePath, relativeBase ? `${relativeBase}/${item}` : item);
        }
      }
    };

    try {
      scanDir('');
    } catch (error) {
      // If root doesn't exist or is empty, return empty array
    }

    return files;
  }

  /**
   * Get all files and folders
   */
  getAllLoadedFiles(): TAbstractFile[] {
    const items: TAbstractFile[] = [];

    const scanDir = (dir: string, relativeBase: string = '') => {
      const itemNames = fs.readdirSync(path.join(this.rootDir, dir));

      for (const itemName of itemNames) {
        const relativePath = relativeBase ? `${relativeBase}/${itemName}` : itemName;
        const fullPath = this.getFullPath(relativePath);
        const stats = fs.statSync(fullPath);

        if (stats.isDirectory()) {
          items.push(new TFolder(relativePath));
          scanDir(relativePath, relativeBase ? `${relativeBase}/${itemName}` : itemName);
        } else {
          items.push(new TFile(relativePath));
        }
      }
    };

    try {
      scanDir('');
    } catch (error) {
      // If root doesn't exist or is empty, return empty array
    }

    return items;
  }

  /**
   * Check if a file or folder exists
   */
  exists(filePath: string): boolean {
    const fullPath = this.getFullPath(filePath);
    return fs.existsSync(fullPath);
  }

  /**
   * Adapter for low-level filesystem operations
   * Required by KBManager for fallback access to hidden folders
   */
  get adapter() {
    const rootDir = this.rootDir;

    return {
      exists: async (filePath: string): Promise<boolean> => {
        const fullPath = path.join(rootDir, filePath);
        return fs.existsSync(fullPath);
      },

      read: async (filePath: string): Promise<string> => {
        const fullPath = path.join(rootDir, filePath);
        if (!fs.existsSync(fullPath)) {
          throw new Error(`File not found: ${filePath}`);
        }
        return fs.readFileSync(fullPath, 'utf-8');
      },

      list: async (dirPath: string): Promise<{ files: string[]; folders: string[] }> => {
        const fullPath = path.join(rootDir, dirPath);
        const files: string[] = [];
        const folders: string[] = [];

        if (!fs.existsSync(fullPath)) {
          return { files, folders };
        }

        try {
          const items = fs.readdirSync(fullPath);
          for (const item of items) {
            const itemPath = path.join(dirPath, item).replace(/\\/g, '/');
            const itemFullPath = path.join(fullPath, item);
            const stats = fs.statSync(itemFullPath);

            if (stats.isDirectory()) {
              folders.push(itemPath);
            } else if (stats.isFile()) {
              files.push(itemPath);
            }
          }
        } catch (error) {
          // Return empty lists on error
        }

        return { files, folders };
      },
    };
  }
}

/**
 * Filesystem-backed App
 */
export class FsApp {
  vault: FsVault;

  constructor(rootDir?: string) {
    this.vault = new FsVault(rootDir);
  }

  /**
   * Cleanup the vault's temp directory
   */
  cleanup(): void {
    this.vault.cleanup();
  }
}

/**
 * Create a filesystem-backed mock app
 */
export function createFsApp(rootDir?: string): FsApp {
  return new FsApp(rootDir);
}

/**
 * Helper to set up a filesystem-backed vault with pre-populated KB structure
 */
export function createFsVaultWithKB(
  kbName: string,
  subfolder: string,
  organizationRules: string = 'Default rules'
): FsApp {
  const app = new FsApp();
  const vault = app.vault;

  // Create KB meta file
  const metaPath = `.llm_bridges/knowledge_base/${kbName}/meta.md`;
  const metaContent = `---
create_time: "${new Date().toISOString()}"
description: "Test knowledge base"
subfolder: "${subfolder}"
---

${organizationRules}`;

  // Use sync file operations for setup
  const metaFullPath = path.join(vault.getRootDir(), metaPath);
  fs.mkdirSync(path.dirname(metaFullPath), { recursive: true });
  fs.writeFileSync(metaFullPath, metaContent, 'utf-8');

  // Create folder_constraints directory
  const constraintsPath = `.llm_bridges/knowledge_base/${kbName}/folder_constraints`;
  const constraintsFullPath = path.join(vault.getRootDir(), constraintsPath);
  fs.mkdirSync(constraintsFullPath, { recursive: true });

  // Create the KB subfolder
  const subfolderFullPath = path.join(vault.getRootDir(), subfolder);
  fs.mkdirSync(subfolderFullPath, { recursive: true });

  return app;
}
