/**
 * Filesystem-backed Integration tests for KBManager
 * Level 3 Testing - Real filesystem operations
 *
 * These tests verify the actual KBManager implementation against
 * a filesystem-backed mock Obsidian Vault that creates real files.
 * This validates file behavior while keeping production code unchanged.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { FsApp, createFsApp, createFsVaultWithKB } from '../mocks/fs-obsidian';
import { KBManager } from '../../src/kb-manager';

describe('KBManager Filesystem-backed Integration Tests', () => {
  let app: FsApp;
  let kbManager: KBManager;

  beforeEach(() => {
    app = createFsApp();
    kbManager = new KBManager(app as any);
  });

  afterEach(() => {
    // Cleanup temp directory after each test
    app.cleanup();
  });

  // ============================================================================
  // Knowledge Base CRUD Operations - Filesystem Validation
  // ============================================================================

  describe('Knowledge Base File Operations', () => {
    it('should create meta.md file on disk', async () => {
      await kbManager.addKnowledgeBase('test-kb', 'Test KB', 'test-folder', 'Test rules');

      const metaPath = '.llm_bridges/knowledge_base/test-kb/meta.md';
      const fullPath = path.join(app.vault.getRootDir(), metaPath);

      // Verify file exists on actual filesystem
      expect(fs.existsSync(fullPath)).toBe(true);

      // Verify file content
      const content = fs.readFileSync(fullPath, 'utf-8');
      expect(content).toContain('description: "Test KB"');
      expect(content).toContain('subfolder: "test-folder"');
      expect(content).toContain('Test rules');
    });

    it('should create folder_constraints directory on disk', async () => {
      await kbManager.addKnowledgeBase('test-kb', 'Test KB', 'test-folder', 'Test rules');

      const constraintsPath = '.llm_bridges/knowledge_base/test-kb/folder_constraints';
      const fullPath = path.join(app.vault.getRootDir(), constraintsPath);

      // Verify directory exists on actual filesystem
      expect(fs.existsSync(fullPath)).toBe(true);
      expect(fs.statSync(fullPath).isDirectory()).toBe(true);
    });

    it('should create KB subfolder on disk', async () => {
      await kbManager.addKnowledgeBase('test-kb', 'Test KB', 'my-documents', 'Test rules');

      const subfolderPath = 'my-documents';
      const fullPath = path.join(app.vault.getRootDir(), subfolderPath);

      // Verify subfolder exists on actual filesystem
      expect(fs.existsSync(fullPath)).toBe(true);
      expect(fs.statSync(fullPath).isDirectory()).toBe(true);
    });

    it('should persist KB metadata correctly', async () => {
      const kb = await kbManager.addKnowledgeBase(
        'persist-test',
        'Persistence Test',
        'persist-folder',
        'Organization rules for testing persistence'
      );

      // Verify via filesystem read
      const metaPath = path.join(
        app.vault.getRootDir(),
        '.llm_bridges/knowledge_base/persist-test/meta.md'
      );
      const content = fs.readFileSync(metaPath, 'utf-8');

      // Parse frontmatter
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      expect(frontmatterMatch).not.toBeNull();

      const frontmatter = frontmatterMatch![1];
      expect(frontmatter).toContain('description: "Persistence Test"');
      expect(frontmatter).toContain('subfolder: "persist-folder"');
      expect(frontmatter).toContain('create_time:');

      // Verify rules section
      expect(content).toContain('Organization rules for testing persistence');
    });

    it('should update KB metadata on disk', async () => {
      await kbManager.addKnowledgeBase('update-test', 'Original', 'update-folder', 'Original rules');

      await kbManager.updateKnowledgeBase('update-test', {
        description: 'Updated description',
        organization_rules: 'Updated rules',
      });

      // Verify changes persisted to disk
      const metaPath = path.join(
        app.vault.getRootDir(),
        '.llm_bridges/knowledge_base/update-test/meta.md'
      );
      const content = fs.readFileSync(metaPath, 'utf-8');

      expect(content).toContain('description: "Updated description"');
      expect(content).toContain('Updated rules');
      expect(content).not.toContain('Original description');
      expect(content).not.toContain('Original rules');
    });

    it('should create nested folder structure', async () => {
      await kbManager.addKnowledgeBase('nested-test', 'Test', 'docs/api/v1', 'Test rules');

      const vaultRoot = app.vault.getRootDir();

      // Verify full nested structure exists
      expect(fs.existsSync(path.join(vaultRoot, 'docs'))).toBe(true);
      expect(fs.existsSync(path.join(vaultRoot, 'docs/api'))).toBe(true);
      expect(fs.existsSync(path.join(vaultRoot, 'docs/api/v1'))).toBe(true);

      // Verify all are directories
      expect(fs.statSync(path.join(vaultRoot, 'docs')).isDirectory()).toBe(true);
      expect(fs.statSync(path.join(vaultRoot, 'docs/api')).isDirectory()).toBe(true);
      expect(fs.statSync(path.join(vaultRoot, 'docs/api/v1')).isDirectory()).toBe(true);
    });
  });

  // ============================================================================
  // Folder Constraint Operations - Filesystem Validation
  // ============================================================================

  describe('Folder Constraint File Operations', () => {
    beforeEach(async () => {
      await kbManager.addKnowledgeBase('constraint-test', 'Test KB', 'test-notes', 'Test rules');
    });

    it('should create constraint file on disk', async () => {
      await kbManager.addFolderConstraint('constraint-test', 'test-notes', {
        frontmatter: {
          required_fields: [{ name: 'title', type: 'string' }],
        },
      });

      const constraintPath = path.join(
        app.vault.getRootDir(),
        '.llm_bridges/knowledge_base/constraint-test/folder_constraints/test-notes.md'
      );

      // Verify file exists on actual filesystem
      expect(fs.existsSync(constraintPath)).toBe(true);

      // Verify file content
      const content = fs.readFileSync(constraintPath, 'utf-8');
      expect(content).toContain('subfolder: "test-notes"');
      expect(content).toContain('required_fields:');
      expect(content).toContain('- name: title');
      expect(content).toContain('type: string');
    });

    it('should handle nested folder constraint paths', async () => {
      await kbManager.addFolderConstraint('constraint-test', 'test-notes/daily', {
        frontmatter: {
          required_fields: [{ name: 'date', type: 'date' }],
        },
      });

      // Constraint file should use sanitized filename (/ becomes _)
      const constraintPath = path.join(
        app.vault.getRootDir(),
        '.llm_bridges/knowledge_base/constraint-test/folder_constraints/test-notes_daily.md'
      );

      expect(fs.existsSync(constraintPath)).toBe(true);

      const content = fs.readFileSync(constraintPath, 'utf-8');
      expect(content).toContain('subfolder: "test-notes/daily"');
    });

    it('should update existing constraint file', async () => {
      await kbManager.addFolderConstraint('constraint-test', 'test-notes', {
        frontmatter: {
          required_fields: [{ name: 'title', type: 'string' }],
        },
      });

      await kbManager.addFolderConstraint('constraint-test', 'test-notes', {
        frontmatter: {
          required_fields: [
            { name: 'title', type: 'string' },
            { name: 'author', type: 'string' },
          ],
        },
      });

      const constraintPath = path.join(
        app.vault.getRootDir(),
        '.llm_bridges/knowledge_base/constraint-test/folder_constraints/test-notes.md'
      );

      const content = fs.readFileSync(constraintPath, 'utf-8');
      expect(content).toContain('- name: title');
      expect(content).toContain('- name: author');
    });

    it('should persist complex constraint rules', async () => {
      await kbManager.addFolderConstraint('constraint-test', 'test-notes', {
        frontmatter: {
          required_fields: [
            { name: 'status', type: 'string', allowed_values: ['draft', 'review', 'published'] },
            { name: 'priority', type: 'number' },
          ],
        },
        filename: {
          pattern: '^[a-z0-9-]+\\.md$',
        },
        content: {
          min_length: 50,
          required_sections: ['Summary', 'Details'],
        },
      });

      const constraintPath = path.join(
        app.vault.getRootDir(),
        '.llm_bridges/knowledge_base/constraint-test/folder_constraints/test-notes.md'
      );

      const content = fs.readFileSync(constraintPath, 'utf-8');

      // Verify frontmatter rules
      expect(content).toContain('required_fields:');
      expect(content).toContain('- name: status');
      expect(content).toContain('allowed_values:');
      expect(content).toContain('"draft"');
      expect(content).toContain('"review"');
      expect(content).toContain('"published"');

      // Verify filename rules
      expect(content).toContain('filename:');
      expect(content).toContain('pattern: "^[a-z0-9-]+\\.md$"');

      // Verify content rules
      expect(content).toContain('content:');
      expect(content).toContain('min_length: 50');
      expect(content).toContain('required_sections:');
      expect(content).toContain('"Summary"');
      expect(content).toContain('"Details"');
    });
  });

  // ============================================================================
  // Pre-populated Vault Tests - Filesystem Validation
  // ============================================================================

  describe('Pre-populated Vault Operations', () => {
    it('should read pre-populated KB from filesystem', async () => {
      const prePopApp = createFsVaultWithKB('existing-kb', 'existing-notes', 'Existing rules');
      const prePopManager = new KBManager(prePopApp as any);

      try {
        const kbs = await prePopManager.listKnowledgeBases();

        expect(kbs).toHaveLength(1);
        expect(kbs[0].name).toBe('existing-kb');
        expect(kbs[0].subfolder).toBe('existing-notes');
        expect(kbs[0].organization_rules_preview).toContain('Existing rules');

        // Verify filesystem has the expected structure
        const vaultRoot = prePopApp.vault.getRootDir();
        const metaPath = path.join(vaultRoot, '.llm_bridges/knowledge_base/existing-kb/meta.md');
        const constraintsDir = path.join(
          vaultRoot,
          '.llm_bridges/knowledge_base/existing-kb/folder_constraints'
        );
        const subfolderPath = path.join(vaultRoot, 'existing-notes');

        expect(fs.existsSync(metaPath)).toBe(true);
        expect(fs.existsSync(constraintsDir)).toBe(true);
        expect(fs.existsSync(subfolderPath)).toBe(true);
      } finally {
        prePopApp.cleanup();
      }
    });

    it('should handle multiple KBs in filesystem', async () => {
      const prePopApp = createFsApp();
      const vaultRoot = prePopApp.vault.getRootDir();

      // Manually create multiple KBs on filesystem
      const kb1Path = path.join(vaultRoot, '.llm_bridges/knowledge_base/kb1/meta.md');
      const kb2Path = path.join(vaultRoot, '.llm_bridges/knowledge_base/kb2/meta.md');

      fs.mkdirSync(path.dirname(kb1Path), { recursive: true });
      fs.writeFileSync(
        kb1Path,
        `---
create_time: "${new Date().toISOString()}"
description: "First KB"
subfolder: "folder1"
---

Rules 1`,
        'utf-8'
      );

      fs.mkdirSync(path.dirname(kb2Path), { recursive: true });
      fs.writeFileSync(
        kb2Path,
        `---
create_time: "${new Date().toISOString()}"
description: "Second KB"
subfolder: "folder2"
---

Rules 2`,
        'utf-8'
      );

      // Create constraint folders
      fs.mkdirSync(
        path.join(vaultRoot, '.llm_bridges/knowledge_base/kb1/folder_constraints'),
        { recursive: true }
      );
      fs.mkdirSync(
        path.join(vaultRoot, '.llm_bridges/knowledge_base/kb2/folder_constraints'),
        { recursive: true }
      );

      const prePopManager = new KBManager(prePopApp as any);

      try {
        const kbs = await prePopManager.listKnowledgeBases();

        expect(kbs).toHaveLength(2);
        expect(kbs.map((kb) => kb.name).sort()).toEqual(['kb1', 'kb2']);
      } finally {
        prePopApp.cleanup();
      }
    });
  });

  // ============================================================================
  // Edge Cases - Filesystem Validation
  // ============================================================================

  describe('Filesystem Edge Cases', () => {
    it('should handle special characters in KB names', async () => {
      await kbManager.addKnowledgeBase('test_kb-v2', 'Test KB', 'test-folder', 'Test rules');

      const metaPath = path.join(app.vault.getRootDir(), '.llm_bridges/knowledge_base/test_kb-v2/meta.md');

      expect(fs.existsSync(metaPath)).toBe(true);
    });

    it('should handle empty organization rules', async () => {
      await kbManager.addKnowledgeBase('empty-rules', 'Test', 'test-folder', '');

      const metaPath = path.join(app.vault.getRootDir(), '.llm_bridges/knowledge_base/empty-rules/meta.md');
      const content = fs.readFileSync(metaPath, 'utf-8');

      // Empty organization rules should result in metadata without the rules section
      // This is valid - the file exists and has frontmatter
      expect(content).toContain('subfolder: "test-folder"');
    });

    it('should list KBs from actual filesystem scan', async () => {
      // Create KBs
      await kbManager.addKnowledgeBase('kb1', 'First', 'folder1', 'Rules 1');
      await kbManager.addKnowledgeBase('kb2', 'Second', 'folder2', 'Rules 2');

      // Verify by scanning filesystem directly
      const kbBasePath = path.join(app.vault.getRootDir(), '.llm_bridges/knowledge_base');
      const kbDirs = fs.readdirSync(kbBasePath).filter(name => name !== 'metadata.json');

      expect(kbDirs.sort()).toEqual(['kb1', 'kb2']);

      // Verify each has meta.md
      for (const kbDir of kbDirs) {
        const metaPath = path.join(kbBasePath, kbDir, 'meta.md');
        expect(fs.existsSync(metaPath)).toBe(true);
      }
    });
  });
});
