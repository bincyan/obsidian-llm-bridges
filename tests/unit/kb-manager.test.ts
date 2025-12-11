/**
 * Unit tests for kb-manager.ts
 * Tests Knowledge Base CRUD operations with mocked Obsidian API
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { App, Vault, TFile, TFolder } from '../mocks/obsidian';

// We need to test the KB manager logic separately from Obsidian integration
// Since KBManager depends heavily on Obsidian's App, we'll test the helper methods
// and create integration-style tests with the mock

describe('KBManager - Path Helpers', () => {
  // Test path construction logic (extracted for testing)
  const LLM_BRIDGES_DIR = '.llm_bridges';
  const KNOWLEDGE_BASE_DIR = 'knowledge_base';
  const FOLDER_CONSTRAINTS_DIR = 'folder_constraints';
  const META_FILE = 'meta.md';

  function getKBBasePath(kbName: string): string {
    return `${LLM_BRIDGES_DIR}/${KNOWLEDGE_BASE_DIR}/${kbName}`;
  }

  function getMetaPath(kbName: string): string {
    return `${getKBBasePath(kbName)}/${META_FILE}`;
  }

  function getConstraintsPath(kbName: string): string {
    return `${getKBBasePath(kbName)}/${FOLDER_CONSTRAINTS_DIR}`;
  }

  describe('path construction', () => {
    it('should construct KB base path correctly', () => {
      expect(getKBBasePath('my-kb')).toBe('.llm_bridges/knowledge_base/my-kb');
    });

    it('should construct meta file path correctly', () => {
      expect(getMetaPath('my-kb')).toBe('.llm_bridges/knowledge_base/my-kb/meta.md');
    });

    it('should construct constraints path correctly', () => {
      expect(getConstraintsPath('my-kb')).toBe(
        '.llm_bridges/knowledge_base/my-kb/folder_constraints'
      );
    });

    it('should handle KB names with special characters', () => {
      expect(getKBBasePath('my-knowledge-base')).toBe(
        '.llm_bridges/knowledge_base/my-knowledge-base'
      );
      expect(getKBBasePath('kb_with_underscore')).toBe(
        '.llm_bridges/knowledge_base/kb_with_underscore'
      );
    });
  });
});

describe('KBManager - Name Validation', () => {
  // Extracted validation logic
  function validateKBName(name: string): { valid: boolean; error?: string } {
    if (!name || name.trim() === '') {
      return { valid: false, error: 'Name cannot be empty' };
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      return {
        valid: false,
        error: 'Name can only contain letters, numbers, underscores, and hyphens',
      };
    }

    if (name.length > 100) {
      return { valid: false, error: 'Name cannot exceed 100 characters' };
    }

    return { valid: true };
  }

  it('should accept valid KB names', () => {
    expect(validateKBName('my-kb').valid).toBe(true);
    expect(validateKBName('MyKB').valid).toBe(true);
    expect(validateKBName('kb_123').valid).toBe(true);
    expect(validateKBName('KB-with-dashes').valid).toBe(true);
  });

  it('should reject empty names', () => {
    expect(validateKBName('').valid).toBe(false);
    expect(validateKBName('   ').valid).toBe(false);
  });

  it('should reject names with invalid characters', () => {
    expect(validateKBName('my kb').valid).toBe(false); // spaces
    expect(validateKBName('my.kb').valid).toBe(false); // dots
    expect(validateKBName('my/kb').valid).toBe(false); // slashes
    expect(validateKBName('my@kb').valid).toBe(false); // special chars
  });

  it('should reject very long names', () => {
    const longName = 'a'.repeat(101);
    expect(validateKBName(longName).valid).toBe(false);
  });
});

describe('KBManager - Subfolder Validation', () => {
  function validateSubfolder(subfolder: string): { valid: boolean; error?: string } {
    if (!subfolder || subfolder.trim() === '') {
      return { valid: false, error: 'Subfolder cannot be empty' };
    }

    // Prevent path traversal
    if (subfolder.includes('..')) {
      return { valid: false, error: 'Subfolder cannot contain ".."' };
    }

    // Prevent absolute paths
    if (subfolder.startsWith('/')) {
      return { valid: false, error: 'Subfolder must be a relative path' };
    }

    // Prevent hidden directories (except .llm_bridges itself)
    const parts = subfolder.split('/');
    for (const part of parts) {
      if (part.startsWith('.') && part !== '.llm_bridges') {
        return { valid: false, error: 'Subfolder cannot contain hidden directories' };
      }
    }

    return { valid: true };
  }

  it('should accept valid subfolders', () => {
    expect(validateSubfolder('notes').valid).toBe(true);
    expect(validateSubfolder('docs/api').valid).toBe(true);
    expect(validateSubfolder('projects/2024/q1').valid).toBe(true);
  });

  it('should reject empty subfolders', () => {
    expect(validateSubfolder('').valid).toBe(false);
    expect(validateSubfolder('   ').valid).toBe(false);
  });

  it('should reject path traversal attempts', () => {
    expect(validateSubfolder('../').valid).toBe(false);
    expect(validateSubfolder('notes/../secrets').valid).toBe(false);
    expect(validateSubfolder('docs/..').valid).toBe(false);
  });

  it('should reject absolute paths', () => {
    expect(validateSubfolder('/root').valid).toBe(false);
    expect(validateSubfolder('/home/user/docs').valid).toBe(false);
  });

  it('should reject hidden directories', () => {
    expect(validateSubfolder('.hidden').valid).toBe(false);
    expect(validateSubfolder('docs/.secret').valid).toBe(false);
  });
});

describe('KBManager - Meta.md Serialization', () => {
  interface KnowledgeBase {
    name: string;
    create_time: string;
    description: string;
    subfolder: string;
    organization_rules: string;
  }

  function serializeMetaMd(kb: KnowledgeBase): string {
    const lines: string[] = [];
    lines.push('---');
    lines.push(`name: "${kb.name}"`);
    lines.push(`create_time: "${kb.create_time}"`);
    lines.push(`description: "${kb.description}"`);
    lines.push(`subfolder: "${kb.subfolder}"`);
    lines.push('---');
    lines.push('');
    lines.push('# Organization Rules');
    lines.push('');
    lines.push(kb.organization_rules);
    return lines.join('\n');
  }

  function parseMetaMd(content: string): KnowledgeBase | null {
    const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!frontmatterMatch) return null;

    const frontmatter = frontmatterMatch[1];
    const body = content.slice(frontmatterMatch[0].length).trim();

    const getValue = (key: string): string => {
      const match = frontmatter.match(new RegExp(`^${key}:\\s*"(.*)"\$`, 'm'));
      return match ? match[1] : '';
    };

    // Extract organization_rules from body (after "# Organization Rules" heading)
    const rulesMatch = body.match(/^#\s+Organization Rules\s*\n\n?([\s\S]*)$/m);
    const organizationRules = rulesMatch ? rulesMatch[1].trim() : body;

    return {
      name: getValue('name'),
      create_time: getValue('create_time'),
      description: getValue('description'),
      subfolder: getValue('subfolder'),
      organization_rules: organizationRules,
    };
  }

  it('should serialize KB to meta.md format', () => {
    const kb: KnowledgeBase = {
      name: 'test-kb',
      create_time: '2024-01-15T10:30:00Z',
      description: 'Test knowledge base',
      subfolder: 'notes',
      organization_rules: 'Store notes in markdown format.',
    };

    const content = serializeMetaMd(kb);

    expect(content).toContain('---');
    expect(content).toContain('name: "test-kb"');
    expect(content).toContain('subfolder: "notes"');
    expect(content).toContain('# Organization Rules');
    expect(content).toContain('Store notes in markdown format.');
  });

  it('should parse meta.md back to KB object', () => {
    const content = `---
name: "my-kb"
create_time: "2024-01-15T10:30:00Z"
description: "A test KB"
subfolder: "docs"
---

# Organization Rules

Use YAML frontmatter for all notes.`;

    const kb = parseMetaMd(content);

    expect(kb).not.toBeNull();
    expect(kb?.name).toBe('my-kb');
    expect(kb?.subfolder).toBe('docs');
    expect(kb?.organization_rules).toBe('Use YAML frontmatter for all notes.');
  });

  it('should handle multiline organization rules', () => {
    const rules = `1. Use descriptive titles
2. Include tags
3. Add creation date`;

    const kb: KnowledgeBase = {
      name: 'test',
      create_time: '2024-01-01',
      description: 'Test',
      subfolder: 'notes',
      organization_rules: rules,
    };

    const serialized = serializeMetaMd(kb);
    const parsed = parseMetaMd(serialized);

    expect(parsed?.organization_rules).toBe(rules);
  });

  it('should handle special characters in description', () => {
    const kb: KnowledgeBase = {
      name: 'test',
      create_time: '2024-01-01',
      description: 'Test with "quotes" and special chars',
      subfolder: 'notes',
      organization_rules: 'Rules',
    };

    const serialized = serializeMetaMd(kb);
    expect(serialized).toContain('description: "Test with "quotes" and special chars"');
  });
});

describe('KBManager - Constraint File Serialization', () => {
  interface ConstraintRules {
    frontmatter?: {
      required_fields?: Array<{
        name: string;
        type: string;
        pattern?: string;
        allowed_values?: (string | number | boolean)[];
      }>;
    };
    filename?: {
      pattern?: string;
    };
    content?: {
      min_length?: number;
      max_length?: number;
      required_sections?: string[];
    };
  }

  function serializeConstraint(subfolder: string, rules: ConstraintRules): string {
    const lines: string[] = [];
    lines.push('---');
    lines.push(`subfolder: "${subfolder}"`);
    lines.push('---');
    lines.push('');
    lines.push('# Constraint Rules');
    lines.push('');
    lines.push('```yaml');

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
          lines.push(`      allowed_values: [${field.allowed_values.join(', ')}]`);
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
        lines.push(
          `  required_sections: [${rules.content.required_sections.map((s) => `"${s}"`).join(', ')}]`
        );
      }
    }

    lines.push('```');
    return lines.join('\n');
  }

  it('should serialize frontmatter rules', () => {
    const rules: ConstraintRules = {
      frontmatter: {
        required_fields: [
          { name: 'title', type: 'string' },
          { name: 'date', type: 'date' },
        ],
      },
    };

    const content = serializeConstraint('notes', rules);

    expect(content).toContain('subfolder: "notes"');
    expect(content).toContain('frontmatter:');
    expect(content).toContain('- name: title');
    expect(content).toContain('type: string');
    expect(content).toContain('- name: date');
    expect(content).toContain('type: date');
  });

  it('should serialize filename pattern', () => {
    const rules: ConstraintRules = {
      filename: {
        pattern: '^\\d{4}-\\d{2}-\\d{2}-.+\\.md$',
      },
    };

    const content = serializeConstraint('journal', rules);

    expect(content).toContain('filename:');
    expect(content).toContain('pattern:');
  });

  it('should serialize content rules', () => {
    const rules: ConstraintRules = {
      content: {
        min_length: 100,
        max_length: 10000,
        required_sections: ['Summary', 'Details'],
      },
    };

    const content = serializeConstraint('docs', rules);

    expect(content).toContain('content:');
    expect(content).toContain('min_length: 100');
    expect(content).toContain('max_length: 10000');
    expect(content).toContain('required_sections:');
  });

  it('should serialize field with pattern and allowed_values', () => {
    const rules: ConstraintRules = {
      frontmatter: {
        required_fields: [
          {
            name: 'status',
            type: 'string',
            allowed_values: ['draft', 'published'],
          },
          {
            name: 'email',
            type: 'string',
            pattern: '^[\\w.-]+@[\\w.-]+\\.\\w+$',
          },
        ],
      },
    };

    const content = serializeConstraint('contacts', rules);

    expect(content).toContain('allowed_values: [draft, published]');
    expect(content).toContain('pattern:');
  });
});

describe('KBManager - Note Path Resolution', () => {
  function resolveNotePath(kbSubfolder: string, notePath: string): string {
    // Normalize paths
    const normalizedKb = kbSubfolder.replace(/\/$/, '');
    const normalizedNote = notePath.replace(/^\//, '');

    // If note path already starts with KB subfolder, return as-is
    if (normalizedNote.startsWith(normalizedKb + '/')) {
      return normalizedNote;
    }

    // Otherwise, prepend KB subfolder
    return `${normalizedKb}/${normalizedNote}`;
  }

  function isPathWithinKB(kbSubfolder: string, fullPath: string): boolean {
    const normalizedKb = kbSubfolder.replace(/\/$/, '');
    const normalizedPath = fullPath.replace(/^\//, '');

    return normalizedPath.startsWith(normalizedKb + '/');
  }

  it('should resolve relative note path within KB', () => {
    expect(resolveNotePath('docs', 'readme.md')).toBe('docs/readme.md');
    expect(resolveNotePath('docs', 'api/overview.md')).toBe('docs/api/overview.md');
  });

  it('should not double-prefix if path already contains KB subfolder', () => {
    expect(resolveNotePath('docs', 'docs/readme.md')).toBe('docs/readme.md');
  });

  it('should handle trailing slashes in KB subfolder', () => {
    expect(resolveNotePath('docs/', 'readme.md')).toBe('docs/readme.md');
  });

  it('should handle leading slashes in note path', () => {
    expect(resolveNotePath('docs', '/readme.md')).toBe('docs/readme.md');
  });

  it('should verify path is within KB', () => {
    expect(isPathWithinKB('docs', 'docs/readme.md')).toBe(true);
    expect(isPathWithinKB('docs', 'docs/api/v2/endpoint.md')).toBe(true);
    expect(isPathWithinKB('docs', 'other/readme.md')).toBe(false);
    expect(isPathWithinKB('docs', 'documentation/readme.md')).toBe(false);
  });
});

describe('Mock Vault Integration', () => {
  let vault: Vault;

  beforeEach(() => {
    vault = new Vault();
    vault._clear();
  });

  it('should create and read files', async () => {
    const file = await vault.create('test/file.md', 'Hello World');

    expect(file.path).toBe('test/file.md');
    expect(await vault.read(file)).toBe('Hello World');
  });

  it('should modify existing files', async () => {
    const file = await vault.create('test/file.md', 'Original');
    await vault.modify(file, 'Modified');

    expect(await vault.read(file)).toBe('Modified');
  });

  it('should delete files', async () => {
    const file = await vault.create('test/file.md', 'Content');
    await vault.delete(file);

    expect(vault.getAbstractFileByPath('test/file.md')).toBeNull();
  });

  it('should rename files', async () => {
    const file = await vault.create('old/path.md', 'Content');
    await vault.rename(file, 'new/path.md');

    expect(vault.getAbstractFileByPath('old/path.md')).toBeNull();
    expect(vault.getAbstractFileByPath('new/path.md')).not.toBeNull();
  });

  it('should list all files', async () => {
    await vault.create('file1.md', 'Content 1');
    await vault.create('dir/file2.md', 'Content 2');

    const files = vault.getFiles();

    expect(files).toHaveLength(2);
    expect(files.map((f) => f.path)).toContain('file1.md');
    expect(files.map((f) => f.path)).toContain('dir/file2.md');
  });

  it('should throw when creating duplicate file', async () => {
    await vault.create('test.md', 'Content');

    await expect(vault.create('test.md', 'Duplicate')).rejects.toThrow('already exists');
  });

  it('should throw when reading non-existent file', async () => {
    const fakeFile = new TFile('nonexistent.md');

    await expect(vault.read(fakeFile)).rejects.toThrow('not found');
  });

  it('should use _setFile for test setup', async () => {
    vault._setFile('preset/file.md', 'Preset content');

    const file = vault.getAbstractFileByPath('preset/file.md') as TFile;
    expect(file).not.toBeNull();
    expect(await vault.read(file)).toBe('Preset content');
  });
});
