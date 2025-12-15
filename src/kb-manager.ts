/**
 * Knowledge Base Manager
 * Handles CRUD operations for Knowledge Bases and Folder Constraints
 * Based on spec/03-storage-layout.md
 */

import { App, TFile, TFolder } from 'obsidian';
import {
  KnowledgeBase,
  KnowledgeBaseSummary,
  FolderConstraint,
  ConstraintRules,
  RequiredField,
  LLM_BRIDGES_DIR,
  KNOWLEDGE_BASE_DIR,
  FOLDER_CONSTRAINTS_DIR,
  META_FILE,
  ApiError,
} from './types';

export class KBManager {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  // ============================================================================
  // Path Helpers
  // ============================================================================

  /**
   * Get the base path for all KB storage
   */
  private getKBBasePath(): string {
    return `${LLM_BRIDGES_DIR}/${KNOWLEDGE_BASE_DIR}`;
  }

  /**
   * Get the path for a specific KB's directory
   */
  private getKBPath(kbName: string): string {
    return `${this.getKBBasePath()}/${kbName}`;
  }

  /**
   * Get the path for a KB's meta.md file
   */
  private getMetaPath(kbName: string): string {
    return `${this.getKBPath(kbName)}/${META_FILE}`;
  }

  /**
   * Get the path for a KB's folder_constraints directory
   */
  private getConstraintsPath(kbName: string): string {
    return `${this.getKBPath(kbName)}/${FOLDER_CONSTRAINTS_DIR}`;
  }

  /**
   * Metadata cache path for KB listings
   */
  private getMetadataPath(): string {
    return `${this.getKBBasePath()}/metadata.json`;
  }

  // ============================================================================
  // Knowledge Base Operations
  // ============================================================================

  /**
   * List all Knowledge Bases
   */
  async listKnowledgeBases(): Promise<KnowledgeBaseSummary[]> {
    const basePath = this.getKBBasePath();
    // Ensure base folder exists so we don't return empty just because the root hasn't been created yet
    await this.ensureFolder(basePath);

    // Try metadata cache first
    const cached = await this.loadMetadataCache();
    if (cached && cached.length > 0) {
      await this.logDev(`KB cache hit (${cached.length} entries)`);
      return cached;
    }

    // Rebuild cache by scanning folders
    const kbs = await this.scanKnowledgeBases();
    await this.logDev(`KB cache rebuild: found ${kbs.length} entries`);
    try {
      await this.saveMetadataCache(kbs);
    } catch (error) {
      await this.logDev(`KB cache save failed: ${error instanceof Error ? error.message : String(error)}`);
      // Ignore cache write errors to avoid breaking the API
    }
    return kbs;
  }

  /**
   * Get a single Knowledge Base by name
   */
  async getKnowledgeBase(name: string): Promise<KnowledgeBase | null> {
    const metaPath = this.getMetaPath(name);
    const file = this.app.vault.getAbstractFileByPath(metaPath);

    if (!(file instanceof TFile)) {
      return null;
    }

    const content = await this.app.vault.read(file);
    return this.parseKBMeta(name, content);
  }

  /**
   * Add a new Knowledge Base
   */
  async addKnowledgeBase(
    name: string,
    description: string,
    subfolder: string,
    organizationRules: string
  ): Promise<KnowledgeBase> {
    // Check if KB already exists
    const existing = await this.getKnowledgeBase(name);
    if (existing) {
      throw this.createError('knowledge_base_already_exists', `Knowledge base '${name}' already exists`);
    }

    // Check for subfolder overlap
    const allKBs = await this.listKnowledgeBases();
    for (const kb of allKBs) {
      if (this.subfolderOverlaps(subfolder, kb.subfolder)) {
        throw this.createError(
          'subfolder_overlap',
          `Subfolder '${subfolder}' overlaps with KB '${kb.name}' subfolder '${kb.subfolder}'`
        );
      }
    }

    // Create KB directory structure
    const kbPath = this.getKBPath(name);
    const constraintsPath = this.getConstraintsPath(name);

    await this.ensureFolder(kbPath);
    await this.ensureFolder(constraintsPath);

    // Create meta.md
    const kb: KnowledgeBase = {
      name,
      create_time: new Date().toISOString(),
      description,
      subfolder: this.normalizePath(subfolder),
      organization_rules: organizationRules,
    };

    const metaContent = this.serializeKBMeta(kb);
    await this.app.vault.create(this.getMetaPath(name), metaContent);

    // Ensure KB subfolder exists in vault
    await this.ensureFolder(kb.subfolder);

    // Update metadata cache
    const summary: KnowledgeBaseSummary = {
      name: kb.name,
      description: kb.description,
      subfolder: kb.subfolder,
      create_time: kb.create_time,
      organization_rules_preview: this.getOrganizationRulesPreview(kb.organization_rules),
    };
    await this.updateMetadataCache(summary);

    return kb;
  }

  /**
   * Update an existing Knowledge Base
   */
  async updateKnowledgeBase(
    name: string,
    updates: {
      description?: string;
      subfolder?: string;
      organization_rules?: string;
    }
  ): Promise<KnowledgeBase> {
    const kb = await this.getKnowledgeBase(name);
    if (!kb) {
      throw this.createError('knowledge_base_not_found', `Knowledge base '${name}' not found`);
    }

    // Check for subfolder overlap if changing subfolder
    if (updates.subfolder && updates.subfolder !== kb.subfolder) {
      const allKBs = await this.listKnowledgeBases();
      for (const otherKb of allKBs) {
        if (otherKb.name !== name && this.subfolderOverlaps(updates.subfolder, otherKb.subfolder)) {
          throw this.createError(
            'subfolder_overlap',
            `Subfolder '${updates.subfolder}' overlaps with KB '${otherKb.name}' subfolder '${otherKb.subfolder}'`
          );
        }
      }
    }

    // Apply updates
    const updatedKB: KnowledgeBase = {
      ...kb,
      description: updates.description ?? kb.description,
      subfolder: updates.subfolder ? this.normalizePath(updates.subfolder) : kb.subfolder,
      organization_rules: updates.organization_rules ?? kb.organization_rules,
    };

    // Write updated meta.md
    const metaPath = this.getMetaPath(name);
    const file = this.app.vault.getAbstractFileByPath(metaPath);
    if (file instanceof TFile) {
      await this.app.vault.modify(file, this.serializeKBMeta(updatedKB));
    }

    // Ensure new subfolder exists if changed
    if (updates.subfolder) {
      await this.ensureFolder(updatedKB.subfolder);
    }

    return updatedKB;
  }

  // ============================================================================
  // Folder Constraint Operations
  // ============================================================================

  /**
   * Get all folder constraints for a KB
   */
  async getFolderConstraints(kbName: string): Promise<FolderConstraint[]> {
    const kb = await this.getKnowledgeBase(kbName);
    if (!kb) {
      throw this.createError('knowledge_base_not_found', `Knowledge base '${kbName}' not found`);
    }

    const constraintsPath = this.getConstraintsPath(kbName);
    const folder = this.app.vault.getAbstractFileByPath(constraintsPath);

    if (!(folder instanceof TFolder)) {
      return [];
    }

    const constraints: FolderConstraint[] = [];

    for (const child of folder.children) {
      if (child instanceof TFile && child.extension === 'md') {
        try {
          const content = await this.app.vault.read(child);
          const constraint = this.parseConstraint(kbName, content);
          if (constraint) {
            constraints.push(constraint);
          }
        } catch {
          // Skip invalid constraints
        }
      }
    }

    return constraints;
  }

  /**
   * Add a folder constraint to a KB
   */
  async addFolderConstraint(
    kbName: string,
    subfolder: string,
    rules: ConstraintRules
  ): Promise<FolderConstraint> {
    const kb = await this.getKnowledgeBase(kbName);
    if (!kb) {
      throw this.createError('knowledge_base_not_found', `Knowledge base '${kbName}' not found`);
    }

    // Normalize and validate subfolder
    const normalizedSubfolder = this.normalizePath(subfolder);

    // Check that subfolder is within KB's scope
    if (!normalizedSubfolder.startsWith(kb.subfolder)) {
      throw this.createError(
        'invalid_note_path',
        `Subfolder '${subfolder}' is outside KB's scope '${kb.subfolder}'`
      );
    }

    const constraint: FolderConstraint = {
      kb_name: kbName,
      subfolder: normalizedSubfolder,
      rules,
    };

    // Create constraint file
    const constraintsPath = this.getConstraintsPath(kbName);
    await this.ensureFolder(constraintsPath);

    const filename = this.sanitizeFilename(normalizedSubfolder) + '.md';
    const filePath = `${constraintsPath}/${filename}`;

    const content = this.serializeConstraint(constraint);

    // Check if constraint already exists
    const existingFile = this.app.vault.getAbstractFileByPath(filePath);
    if (existingFile instanceof TFile) {
      // Overwrite existing
      await this.app.vault.modify(existingFile, content);
    } else {
      await this.app.vault.create(filePath, content);
    }

    return constraint;
  }

  // ============================================================================
  // Note Path Validation
  // ============================================================================

  /**
   * Resolve and validate a note path within a KB's scope
   */
  resolveNotePath(kb: KnowledgeBase, notePath: string): string {
    // Normalize the path
    let resolved = notePath;

    // If path doesn't start with KB subfolder, prepend it
    if (!resolved.startsWith(kb.subfolder + '/') && resolved !== kb.subfolder) {
      resolved = `${kb.subfolder}/${notePath}`;
    }

    resolved = this.normalizePath(resolved);

    // Validate path is within KB scope
    if (!resolved.startsWith(kb.subfolder + '/') && resolved !== kb.subfolder) {
      throw this.createError('invalid_note_path', `Path '${notePath}' is outside KB scope '${kb.subfolder}'`);
    }

    // Check for path traversal attempts
    if (resolved.includes('..')) {
      throw this.createError('invalid_note_path', 'Path traversal not allowed');
    }

    return resolved;
  }

  /**
   * Check if a note exists
   */
  noteExists(path: string): boolean {
    const file = this.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile;
  }

  // ============================================================================
  // Serialization
  // ============================================================================

  /**
   * Parse KB meta.md content into KnowledgeBase object
   */
  private parseKBMeta(name: string, content: string): KnowledgeBase {
    const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
    const match = content.match(frontmatterRegex);

    if (!match) {
      throw new Error('Invalid meta.md format');
    }

    const frontmatter = this.parseSimpleYaml(match[1]);
    const organizationRules = match[2].trim();

    return {
      name,
      create_time: String(frontmatter.create_time || new Date().toISOString()),
      description: String(frontmatter.description || ''),
      subfolder: String(frontmatter.subfolder || ''),
      organization_rules: organizationRules,
    };
  }

  /**
   * Serialize KnowledgeBase to meta.md content
   */
  private serializeKBMeta(kb: KnowledgeBase): string {
    return `---
create_time: "${kb.create_time}"
description: "${kb.description.replace(/"/g, '\\"')}"
subfolder: "${kb.subfolder}"
---

${kb.organization_rules}`;
  }

  /**
   * Parse constraint file content
   */
  private parseConstraint(kbName: string, content: string): FolderConstraint | null {
    const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
    const match = content.match(frontmatterRegex);

    if (!match) {
      return null;
    }

    const frontmatter = this.parseSimpleYaml(match[1]);
    const body = match[2];

    // Parse rules from markdown code block
    const rulesMatch = body.match(/```ya?ml\r?\n([\s\S]*?)\r?\n```/);
    let rules: ConstraintRules = {};

    if (rulesMatch) {
      try {
        rules = this.parseRulesYaml(rulesMatch[1]);
      } catch {
        // Use empty rules if parsing fails
      }
    }

    return {
      kb_name: kbName,
      subfolder: String(frontmatter.subfolder || ''),
      rules,
    };
  }

  /**
   * Serialize constraint to markdown
   */
  private serializeConstraint(constraint: FolderConstraint): string {
    const rulesYaml = this.serializeRulesYaml(constraint.rules);

    return `---
subfolder: "${constraint.subfolder}"
---

## Rules

\`\`\`yaml
${rulesYaml}
\`\`\`
`;
  }

  /**
   * Simple YAML parser
   */
  private parseSimpleYaml(yaml: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const lines = yaml.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const colonIndex = trimmed.indexOf(':');
      if (colonIndex > 0) {
        const key = trimmed.slice(0, colonIndex).trim();
        let value = trimmed.slice(colonIndex + 1).trim();

        // Remove quotes
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }

        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Parse rules YAML - handles nested structure
   */
  private parseRulesYaml(yaml: string): ConstraintRules {
    // This is a simplified parser - for production, consider using a proper YAML library
    const rules: ConstraintRules = {};
    const lines = yaml.split('\n');
    let currentSection: string | null = null;
    let currentField: RequiredField | null = null;
    const fields: RequiredField[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      // Top-level section
      if (!line.startsWith(' ') && !line.startsWith('\t')) {
        // Save previous fields
        if (currentSection === 'frontmatter' && fields.length > 0) {
          rules.frontmatter = { required_fields: fields.slice() };
        }

        const colonIdx = trimmed.indexOf(':');
        if (colonIdx > 0) {
          currentSection = trimmed.slice(0, colonIdx).trim();
          const value = trimmed.slice(colonIdx + 1).trim();

          if (currentSection === 'filename' && value) {
            // Handle inline filename pattern
          }
        }
        currentField = null;
        fields.length = 0;
        continue;
      }

      // Nested content
      if (currentSection === 'frontmatter') {
        if (trimmed.startsWith('- name:')) {
          // Save previous field
          if (currentField) {
            fields.push(currentField);
          }
          currentField = { name: trimmed.slice(8).trim(), type: 'string' };
        } else if (currentField && trimmed.includes(':')) {
          const [key, ...valueParts] = trimmed.split(':');
          const keyName = key.trim();
          let value: unknown = valueParts.join(':').trim();

          // Parse value
          if (value === 'true') value = true;
          else if (value === 'false') value = false;
          else if ((value as string).startsWith('[') && (value as string).endsWith(']')) {
            // Parse array
            const arrayStr = (value as string).slice(1, -1);
            value = arrayStr.split(',').map(v => {
              const trimmedV = v.trim().replace(/^["']|["']$/g, '');
              if (trimmedV === 'true') return true;
              if (trimmedV === 'false') return false;
              const num = Number(trimmedV);
              if (!isNaN(num)) return num;
              return trimmedV;
            });
          } else if ((value as string).startsWith('"') || (value as string).startsWith("'")) {
            value = (value as string).slice(1, -1);
          }

          // Set typed properties on RequiredField
          if (keyName === 'type') {
            currentField.type = value as RequiredField['type'];
          } else if (keyName === 'pattern') {
            currentField.pattern = value as string;
          } else if (keyName === 'allowed_values') {
            currentField.allowed_values = value as (string | number | boolean)[];
          }
        }
      } else if (currentSection === 'filename') {
        if (trimmed.startsWith('pattern:')) {
          const pattern = trimmed.slice(8).trim().replace(/^["']|["']$/g, '');
          rules.filename = { pattern };
        }
      } else if (currentSection === 'content') {
        if (!rules.content) rules.content = {};
        const colonIdx = trimmed.indexOf(':');
        if (colonIdx > 0) {
          const key = trimmed.slice(0, colonIdx).trim();
          const value = trimmed.slice(colonIdx + 1).trim();

          if (key === 'min_length' || key === 'max_length') {
            (rules.content as Record<string, unknown>)[key] = parseInt(value) || 0;
          } else if (key === 'required_sections') {
            const arr = value.slice(1, -1).split(',').map(v => v.trim().replace(/^["']|["']$/g, ''));
            (rules.content as Record<string, unknown>)[key] = arr;
          }
        }
      }
    }

    // Save last field
    if (currentSection === 'frontmatter') {
      if (currentField) {
        fields.push(currentField);
      }
      if (fields.length > 0) {
        rules.frontmatter = { required_fields: fields };
      }
    }

    return rules;
  }

  /**
   * Serialize rules to YAML
   */
  private serializeRulesYaml(rules: ConstraintRules): string {
    const lines: string[] = [];

    if (rules.frontmatter?.required_fields) {
      lines.push('frontmatter:');
      lines.push('  required_fields:');
      for (const field of rules.frontmatter.required_fields) {
        lines.push(`    - name: ${field.name}`);
        lines.push(`      type: ${field.type}`);
        if (field.pattern) {
          lines.push(`      pattern: "${field.pattern}"`);
        }
        if (field.allowed_values) {
          const values = field.allowed_values.map(v =>
            typeof v === 'string' ? `"${v}"` : String(v)
          ).join(', ');
          lines.push(`      allowed_values: [${values}]`);
        }
      }
    }

    if (rules.filename?.pattern) {
      lines.push('filename:');
      lines.push(`  pattern: "${rules.filename.pattern}"`);
    }

    if (rules.content) {
      lines.push('content:');
      if (rules.content.min_length !== undefined) {
        lines.push(`  min_length: ${rules.content.min_length}`);
      }
      if (rules.content.max_length !== undefined) {
        lines.push(`  max_length: ${rules.content.max_length}`);
      }
      if (rules.content.required_sections) {
        const sections = rules.content.required_sections.map(s => `"${s}"`).join(', ');
        lines.push(`  required_sections: [${sections}]`);
      }
    }

    return lines.join('\n');
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Ensure a folder exists, creating it if necessary
   */
  private async ensureFolder(path: string): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing) return;

    // Create parent folders recursively
    const parts = path.split('/');
    let currentPath = '';

    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const folder = this.app.vault.getAbstractFileByPath(currentPath);
      if (!folder) {
        try {
          await this.app.vault.createFolder(currentPath);
        } catch (error) {
          // Obsidian may throw if the folder was concurrently created or already exists
          if (error instanceof Error && /already exists/i.test(error.message)) {
            continue;
          }
          throw error;
        }
      }
    }
  }

  /**
   * Normalize a path (remove leading/trailing slashes, etc.)
   */
  private normalizePath(path: string): string {
    return path.replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
  }

  /**
   * Check if two subfolders overlap
   */
  private subfolderOverlaps(a: string, b: string): boolean {
    const normA = this.normalizePath(a);
    const normB = this.normalizePath(b);

    // Exact match means overlap
    if (normA === normB) return true;

    // If either is empty after normalization, treat as no overlap
    if (!normA || !normB) return false;

    // Prevent false positives when one folder name is a prefix of another segment
    const withSlashA = normA.endsWith('/') ? normA : `${normA}/`;
    const withSlashB = normB.endsWith('/') ? normB : `${normB}/`;

    return withSlashA.startsWith(withSlashB) || withSlashB.startsWith(withSlashA);
  }

  /**
   * Load metadata cache if available
   */
  private async loadMetadataCache(): Promise<KnowledgeBaseSummary[] | null> {
    const metadataPath = this.getMetadataPath();
    const file = this.app.vault.getAbstractFileByPath(metadataPath);
    if (!(file instanceof TFile)) return null;

    try {
      const content = await this.app.vault.read(file);
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed.knowledge_bases)) {
        const kbs = parsed.knowledge_bases as KnowledgeBaseSummary[];
        // If cache is empty, force rebuild
        if (!kbs.length) return null;
        await this.logDev(`Loaded KB cache from metadata.json (${kbs.length} entries)`);
        return kbs;
      }
    } catch (error) {
      console.warn('[LLM Bridges] Failed to read KB metadata cache:', error);
      await this.logDev(`Failed to read KB cache: ${error}`);
    }

    return null;
  }

  /**
   * Save metadata cache
   */
  private async saveMetadataCache(kbs: KnowledgeBaseSummary[]): Promise<void> {
    const metadataPath = this.getMetadataPath();
    await this.ensureFolder(this.getKBBasePath());

    const payload = {
      updated_at: new Date().toISOString(),
      knowledge_bases: kbs,
    };

    const file = this.app.vault.getAbstractFileByPath(metadataPath);
    const content = JSON.stringify(payload, null, 2);

    if (file instanceof TFile) {
      await this.app.vault.modify(file, content);
    } else {
      try {
        await this.app.vault.create(metadataPath, content);
      } catch (error) {
        // If file was created concurrently, fall back to modify
        if (error instanceof Error && /already exists/i.test(error.message)) {
          const existing = this.app.vault.getAbstractFileByPath(metadataPath);
          if (existing instanceof TFile) {
            await this.app.vault.modify(existing, content);
            await this.logDev("KB cache file existed; modified existing metadata.json");
            return;
          }
        }
        throw error;
      }
    }
    await this.logDev(`KB cache saved (${kbs.length} entries) to metadata.json`);
  }

  /**
   * Rebuild metadata cache by scanning folders
   */
  private async scanKnowledgeBases(): Promise<KnowledgeBaseSummary[]> {
    const basePath = this.getKBBasePath();
    const baseFolder = this.app.vault.getAbstractFileByPath(basePath);

    if (!(baseFolder instanceof TFolder)) {
      return [];
    }

    const kbs: KnowledgeBaseSummary[] = [];

    for (const child of baseFolder.children) {
      if (child instanceof TFolder) {
        try {
          const kb = await this.getKnowledgeBase(child.name);
          if (kb) {
            kbs.push({
              name: kb.name,
              description: kb.description,
              subfolder: kb.subfolder,
              create_time: kb.create_time,
              organization_rules_preview: this.getOrganizationRulesPreview(kb.organization_rules),
            });
            await this.logDev(`KB scanned: ${kb.name} subfolder=${kb.subfolder}`);
          }
        } catch (error) {
          console.warn(`[LLM Bridges] Skipping invalid knowledge base folder '${child.name}':`, error);
          await this.logDev(`KB scan skip '${child.name}': ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    return kbs;
  }

  /**
   * Update metadata cache with a single KB summary
   */
  private async updateMetadataCache(summary: KnowledgeBaseSummary): Promise<void> {
    let cache = await this.loadMetadataCache();
    if (!cache) {
      cache = await this.scanKnowledgeBases();
    }

    const idx = cache.findIndex((kb) => kb.name === summary.name);
    if (idx >= 0) {
      cache[idx] = summary;
    } else {
      cache.push(summary);
    }

    await this.saveMetadataCache(cache);
  }

  /**
   * Preview helper for organization rules
   */
  private getOrganizationRulesPreview(rules: string): string {
    const trimmed = rules || '';
    if (trimmed.length <= 200) return trimmed;
    return `${trimmed.slice(0, 200)}...`;
  }

  /**
   * Developer logging (delegated to plugin, if available)
   */
  private async logDev(message: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyThis = this as any;
    if (anyThis.plugin && typeof anyThis.plugin.devLog === 'function') {
      await anyThis.plugin.devLog(message);
    }
  }

  /**
   * Create a safe filename from a path
   */
  private sanitizeFilename(path: string): string {
    return path.replace(/\//g, '_').replace(/[^a-zA-Z0-9_-]/g, '');
  }

  /**
   * Create an API error
   */
  private createError(code: ApiError['code'], message: string, details?: unknown): ApiError {
    return { code, message, details };
  }
}
