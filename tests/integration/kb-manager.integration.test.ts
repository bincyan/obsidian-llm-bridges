/**
 * Integration tests for KBManager with mocked Obsidian API
 * Level 2 Testing - Fake Obsidian environment
 *
 * These tests verify the actual KBManager implementation against
 * a mock Obsidian Vault that simulates real file system behavior.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { App, createMockApp, createMockVaultWithKB } from '../mocks/obsidian';
import { KBManager } from '../../src/kb-manager';

describe('KBManager Integration Tests', () => {
  let app: App;
  let kbManager: KBManager;

  beforeEach(() => {
    app = createMockApp();
    kbManager = new KBManager(app as any);
  });

  // ============================================================================
  // Knowledge Base CRUD Operations
  // ============================================================================

  describe('Knowledge Base Operations', () => {
    describe('listKnowledgeBases', () => {
      it('should return empty array when no KBs exist', async () => {
        const kbs = await kbManager.listKnowledgeBases();
        expect(kbs).toEqual([]);
      });

      it('should list existing KBs', async () => {
        // Create a KB using the manager
        await kbManager.addKnowledgeBase('test-kb', 'Test description', 'notes', 'Test rules');

        const kbs = await kbManager.listKnowledgeBases();

        expect(kbs).toHaveLength(1);
        expect(kbs[0].name).toBe('test-kb');
        expect(kbs[0].description).toBe('Test description');
        expect(kbs[0].subfolder).toBe('notes');
      });

      it('should list multiple KBs', async () => {
        await kbManager.addKnowledgeBase('kb1', 'First KB', 'folder1', 'Rules 1');
        await kbManager.addKnowledgeBase('kb2', 'Second KB', 'folder2', 'Rules 2');
        await kbManager.addKnowledgeBase('kb3', 'Third KB', 'folder3', 'Rules 3');

        const kbs = await kbManager.listKnowledgeBases();

        expect(kbs).toHaveLength(3);
        expect(kbs.map((kb) => kb.name).sort()).toEqual(['kb1', 'kb2', 'kb3']);
      });
    });

    describe('getKnowledgeBase', () => {
      it('should return null for non-existent KB', async () => {
        const kb = await kbManager.getKnowledgeBase('nonexistent');
        expect(kb).toBeNull();
      });

      it('should return KB with all fields', async () => {
        await kbManager.addKnowledgeBase(
          'my-kb',
          'My Knowledge Base',
          'documents',
          'Store all documents here.\nUse markdown format.'
        );

        const kb = await kbManager.getKnowledgeBase('my-kb');

        expect(kb).not.toBeNull();
        expect(kb!.name).toBe('my-kb');
        expect(kb!.description).toBe('My Knowledge Base');
        expect(kb!.subfolder).toBe('documents');
        expect(kb!.organization_rules).toContain('Store all documents here');
        expect(kb!.create_time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      });
    });

    describe('addKnowledgeBase', () => {
      it('should create a new KB', async () => {
        const kb = await kbManager.addKnowledgeBase(
          'new-kb',
          'New Knowledge Base',
          'new-folder',
          'Organization rules here'
        );

        expect(kb.name).toBe('new-kb');
        expect(kb.description).toBe('New Knowledge Base');
        expect(kb.subfolder).toBe('new-folder');
        expect(kb.organization_rules).toBe('Organization rules here');
      });

      it('should create meta.md file', async () => {
        await kbManager.addKnowledgeBase('test-kb', 'Test', 'test-folder', 'Rules');

        const metaPath = '.llm_bridges/knowledge_base/test-kb/meta.md';
        const file = app.vault.getAbstractFileByPath(metaPath);

        expect(file).not.toBeNull();
      });

      it('should create folder_constraints directory', async () => {
        await kbManager.addKnowledgeBase('test-kb', 'Test', 'test-folder', 'Rules');

        const constraintsPath = '.llm_bridges/knowledge_base/test-kb/folder_constraints';
        const folder = app.vault.getAbstractFileByPath(constraintsPath);

        expect(folder).not.toBeNull();
      });

      it('should create KB subfolder in vault', async () => {
        await kbManager.addKnowledgeBase('test-kb', 'Test', 'my-documents', 'Rules');

        const subfolder = app.vault.getAbstractFileByPath('my-documents');

        expect(subfolder).not.toBeNull();
      });

      it('should throw error for duplicate KB name', async () => {
        await kbManager.addKnowledgeBase('existing-kb', 'First', 'folder1', 'Rules');

        await expect(
          kbManager.addKnowledgeBase('existing-kb', 'Second', 'folder2', 'Rules')
        ).rejects.toThrow('already exists');
      });

      it('should throw error for overlapping subfolders', async () => {
        await kbManager.addKnowledgeBase('kb1', 'First', 'docs', 'Rules');

        await expect(
          kbManager.addKnowledgeBase('kb2', 'Second', 'docs/api', 'Rules')
        ).rejects.toThrow('overlaps');
      });

      it('should throw error for exact same subfolder', async () => {
        await kbManager.addKnowledgeBase('kb1', 'First', 'notes', 'Rules');

        await expect(kbManager.addKnowledgeBase('kb2', 'Second', 'notes', 'Rules')).rejects.toThrow(
          'overlaps'
        );
      });

      it('should normalize subfolder path', async () => {
        const kb = await kbManager.addKnowledgeBase('test-kb', 'Test', 'folder/', 'Rules');

        expect(kb.subfolder).toBe('folder');
      });
    });

    describe('updateKnowledgeBase', () => {
      beforeEach(async () => {
        await kbManager.addKnowledgeBase('update-test', 'Original', 'original-folder', 'Original rules');
      });

      it('should update description', async () => {
        const updated = await kbManager.updateKnowledgeBase('update-test', {
          description: 'Updated description',
        });

        expect(updated.description).toBe('Updated description');
        expect(updated.subfolder).toBe('original-folder'); // unchanged
      });

      it('should update organization_rules', async () => {
        const updated = await kbManager.updateKnowledgeBase('update-test', {
          organization_rules: 'New rules',
        });

        expect(updated.organization_rules).toBe('New rules');
      });

      it('should update subfolder', async () => {
        const updated = await kbManager.updateKnowledgeBase('update-test', {
          subfolder: 'new-folder',
        });

        expect(updated.subfolder).toBe('new-folder');

        // New folder should exist
        const newFolder = app.vault.getAbstractFileByPath('new-folder');
        expect(newFolder).not.toBeNull();
      });

      it('should throw error for non-existent KB', async () => {
        await expect(
          kbManager.updateKnowledgeBase('nonexistent', { description: 'New' })
        ).rejects.toThrow('not found');
      });

      it('should throw error for overlapping subfolder update', async () => {
        await kbManager.addKnowledgeBase('other-kb', 'Other', 'other-folder', 'Rules');

        await expect(
          kbManager.updateKnowledgeBase('update-test', {
            subfolder: 'other-folder',
          })
        ).rejects.toThrow('overlaps');
      });

      it('should persist updates to file', async () => {
        await kbManager.updateKnowledgeBase('update-test', {
          description: 'Persisted description',
        });

        // Re-read from "disk"
        const kb = await kbManager.getKnowledgeBase('update-test');

        expect(kb!.description).toBe('Persisted description');
      });
    });
  });

  // ============================================================================
  // Folder Constraint Operations
  // ============================================================================

  describe('Folder Constraint Operations', () => {
    beforeEach(async () => {
      await kbManager.addKnowledgeBase('constraint-test', 'Test KB', 'test-notes', 'Test rules');
    });

    describe('getFolderConstraints', () => {
      it('should return empty array when no constraints exist', async () => {
        const constraints = await kbManager.getFolderConstraints('constraint-test');
        expect(constraints).toEqual([]);
      });

      it('should throw error for non-existent KB', async () => {
        await expect(kbManager.getFolderConstraints('nonexistent')).rejects.toThrow('not found');
      });
    });

    describe('addFolderConstraint', () => {
      it('should add a simple constraint', async () => {
        await kbManager.addFolderConstraint('constraint-test', 'test-notes', {
          frontmatter: {
            required_fields: [{ name: 'title', type: 'string' }],
          },
        });

        const constraints = await kbManager.getFolderConstraints('constraint-test');

        expect(constraints).toHaveLength(1);
        expect(constraints[0].subfolder).toBe('test-notes');
        expect(constraints[0].rules.frontmatter?.required_fields).toHaveLength(1);
      });

      it('should add constraint with all rule types', async () => {
        await kbManager.addFolderConstraint('constraint-test', 'test-notes/daily', {
          frontmatter: {
            required_fields: [
              { name: 'date', type: 'date' },
              { name: 'mood', type: 'string', allowed_values: ['happy', 'sad', 'neutral'] },
            ],
          },
          filename: {
            pattern: '^\\d{4}-\\d{2}-\\d{2}\\.md$',
          },
          content: {
            min_length: 100,
            required_sections: ['Reflection'],
          },
        });

        const constraints = await kbManager.getFolderConstraints('constraint-test');
        const constraint = constraints[0];

        // Verify all rule types are stored
        expect(constraint.rules.frontmatter?.required_fields).toBeDefined();
        expect(constraint.rules.frontmatter?.required_fields?.length).toBeGreaterThanOrEqual(1);
        expect(constraint.rules.filename?.pattern).toBe('^\\d{4}-\\d{2}-\\d{2}\\.md$');
        expect(constraint.rules.content?.min_length).toBe(100);
        expect(constraint.rules.content?.required_sections).toContain('Reflection');
      });

      it('should update existing constraint for same subfolder', async () => {
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

        const constraints = await kbManager.getFolderConstraints('constraint-test');

        expect(constraints).toHaveLength(1);
        expect(constraints[0].rules.frontmatter?.required_fields).toHaveLength(2);
      });

      it('should add multiple constraints for different subfolders', async () => {
        await kbManager.addFolderConstraint('constraint-test', 'test-notes', {
          frontmatter: { required_fields: [{ name: 'title', type: 'string' }] },
        });

        await kbManager.addFolderConstraint('constraint-test', 'test-notes/archive', {
          frontmatter: { required_fields: [{ name: 'archived_date', type: 'date' }] },
        });

        const constraints = await kbManager.getFolderConstraints('constraint-test');

        expect(constraints).toHaveLength(2);
      });

      it('should throw error for non-existent KB', async () => {
        await expect(
          kbManager.addFolderConstraint('nonexistent', 'folder', {})
        ).rejects.toThrow('not found');
      });
    });
  });

  // ============================================================================
  // Note Path Operations
  // ============================================================================

  describe('Note Path Operations', () => {
    let kb: Awaited<ReturnType<typeof kbManager.addKnowledgeBase>>;

    beforeEach(async () => {
      kb = await kbManager.addKnowledgeBase('path-test', 'Test', 'documents', 'Rules');
    });

    describe('resolveNotePath', () => {
      it('should prepend KB subfolder to relative path', () => {
        const resolved = kbManager.resolveNotePath(kb, 'note.md');
        expect(resolved).toBe('documents/note.md');
      });

      it('should handle nested paths', () => {
        const resolved = kbManager.resolveNotePath(kb, 'api/reference.md');
        expect(resolved).toBe('documents/api/reference.md');
      });

      it('should not double-prefix if path already contains subfolder', () => {
        const resolved = kbManager.resolveNotePath(kb, 'documents/note.md');
        expect(resolved).toBe('documents/note.md');
      });

      it('should handle leading slashes', () => {
        const resolved = kbManager.resolveNotePath(kb, '/note.md');
        expect(resolved).toBe('documents/note.md');
      });
    });

    describe('noteExists', () => {
      it('should return false for non-existent note', () => {
        expect(kbManager.noteExists('documents/nonexistent.md')).toBe(false);
      });

      it('should return true for existing note', async () => {
        // Create a note file
        await app.vault.create('documents/existing.md', '# Existing Note');

        expect(kbManager.noteExists('documents/existing.md')).toBe(true);
      });
    });
  });

  // ============================================================================
  // Edge Cases and Error Handling
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle KB names with hyphens and underscores', async () => {
      const kb = await kbManager.addKnowledgeBase(
        'my-knowledge_base',
        'Test',
        'test-folder',
        'Rules'
      );

      expect(kb.name).toBe('my-knowledge_base');

      const retrieved = await kbManager.getKnowledgeBase('my-knowledge_base');
      expect(retrieved).not.toBeNull();
    });

    it('should handle deep nested subfolders', async () => {
      const kb = await kbManager.addKnowledgeBase(
        'deep-kb',
        'Test',
        'level1/level2/level3/level4',
        'Rules'
      );

      expect(kb.subfolder).toBe('level1/level2/level3/level4');

      // Verify folder was created
      const folder = app.vault.getAbstractFileByPath('level1/level2/level3/level4');
      expect(folder).not.toBeNull();
    });

    it('should handle multiline organization rules', async () => {
      const rules = `# Main Rules

1. Use descriptive titles
2. Always include tags
3. Add creation date

## Formatting
- Use markdown
- Include headers`;

      const kb = await kbManager.addKnowledgeBase('multiline-kb', 'Test', 'test-folder', rules);

      expect(kb.organization_rules).toBe(rules);

      // Verify persistence
      const retrieved = await kbManager.getKnowledgeBase('multiline-kb');
      expect(retrieved!.organization_rules).toBe(rules);
    });

    it('should handle empty organization rules', async () => {
      const kb = await kbManager.addKnowledgeBase('empty-rules', 'Test', 'test-folder', '');

      expect(kb.organization_rules).toBe('');
    });
  });

  // ============================================================================
  // Concurrent Operations
  // ============================================================================

  describe('Concurrent Operations', () => {
    it('should handle multiple KB creations', async () => {
      const promises = [
        kbManager.addKnowledgeBase('concurrent-1', 'Test 1', 'folder1', 'Rules'),
        kbManager.addKnowledgeBase('concurrent-2', 'Test 2', 'folder2', 'Rules'),
        kbManager.addKnowledgeBase('concurrent-3', 'Test 3', 'folder3', 'Rules'),
      ];

      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
      expect(results.map((r) => r.name).sort()).toEqual([
        'concurrent-1',
        'concurrent-2',
        'concurrent-3',
      ]);
    });

    it('should handle read operations during writes', async () => {
      await kbManager.addKnowledgeBase('read-write', 'Initial', 'folder', 'Rules');

      const [updated, read] = await Promise.all([
        kbManager.updateKnowledgeBase('read-write', { description: 'Updated' }),
        kbManager.getKnowledgeBase('read-write'),
      ]);

      // Both operations should complete without error
      expect(updated).toBeDefined();
      expect(read).toBeDefined();
    });
  });
});

describe('KBManager with Pre-populated Vault', () => {
  it('should work with createMockVaultWithKB helper', async () => {
    const app = createMockVaultWithKB('pre-populated', 'my-docs', 'Pre-populated rules');
    const kbManager = new KBManager(app as any);

    const kb = await kbManager.getKnowledgeBase('pre-populated');

    expect(kb).not.toBeNull();
    expect(kb!.name).toBe('pre-populated');
    expect(kb!.subfolder).toBe('my-docs');
    expect(kb!.organization_rules).toContain('Pre-populated rules');
  });

  it('should list pre-populated KB', async () => {
    const app = createMockVaultWithKB('listed-kb', 'notes', 'Rules');
    const kbManager = new KBManager(app as any);

    const kbs = await kbManager.listKnowledgeBases();

    expect(kbs).toHaveLength(1);
    expect(kbs[0].name).toBe('listed-kb');
  });
});

describe('KBManager adapter fallback', () => {
  it('should list KBs even when .llm_bridges is only visible via adapter', async () => {
    const metaPath = '.llm_bridges/knowledge_base/test/meta.md';
    const metadataPath = '.llm_bridges/knowledge_base/metadata.json';
    const metaContent = `---
create_time: "2024-01-01T00:00:00Z"
description: "Adapter KB"
subfolder: "test"
---

Rules`;

    const adapterFiles = new Map<string, string>([[metaPath, metaContent]]);
    const adapterFolders = new Set<string>([
      '.llm_bridges',
      '.llm_bridges/knowledge_base',
      '.llm_bridges/knowledge_base/test',
    ]);

    const adapter = {
      exists: vi.fn(async (path: string) => adapterFiles.has(path) || adapterFolders.has(path)),
      read: vi.fn(async (path: string) => {
        const content = adapterFiles.get(path);
        if (content === undefined) throw new Error('not found');
        return content;
      }),
      list: vi.fn(async (path: string) => {
        const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
        const depth = normalized.split('/').length + 1;
        const folders = Array.from(adapterFolders).filter(
          (folder) => folder.startsWith(`${normalized}/`) && folder.split('/').length === depth
        );
        return { files: [], folders };
      }),
    };

    const vault = {
      adapter,
      getAbstractFileByPath: () => null,
      createFolder: async (path: string) => {
        adapterFolders.add(path);
      },
      create: async (path: string, content: string) => {
        adapterFiles.set(path, content);
      },
      modify: async (_file: unknown, content: string) => {
        adapterFiles.set(metadataPath, content);
      },
    };

    const appWithAdapter = { vault } as unknown as App;
    const kbManager = new KBManager(appWithAdapter as any);

    const kbs = await kbManager.listKnowledgeBases();

    expect(kbs).toHaveLength(1);
    expect(kbs[0].name).toBe('test');
    expect(adapter.list).toHaveBeenCalled();
  });
});
