import { describe, it, expect, beforeEach } from 'vitest';
import LLMBridgesPlugin from '../../src/main';
import { KBManager } from '../../src/kb-manager';
import { createMockApp } from '../mocks/obsidian';

describe('MCP tool integrations', () => {
  let app: ReturnType<typeof createMockApp>;
  let plugin: LLMBridgesPlugin;

  const manifest = {
    id: 'obsidian-llm-bridges',
    name: 'LLM Bridges',
    version: '0.0.0',
    minAppVersion: '0.0.0',
    description: 'Test manifest',
    author: 'tests',
  };

  const callTool = async (name: string, args: Record<string, unknown>) => {
    const result = await plugin.handleMCPToolCall({ name, arguments: args });
    const text = result.content[0]?.text ?? '';
    return JSON.parse(text);
  };

  beforeEach(() => {
    app = createMockApp();
    plugin = new LLMBridgesPlugin(app as any, manifest as any);
    plugin.kbManager = new KBManager(app as any);
  });

  it('lists and updates knowledge bases via MCP tools', async () => {
    const empty = await callTool('list_knowledge_bases', {});
    expect(empty.knowledge_bases).toEqual([]);

    const created = await callTool('add_knowledge_base', {
      name: 'kb-tools',
      description: 'KB for tools',
      subfolder: 'notes',
    });

    expect(created.knowledge_base.name).toBe('kb-tools');
    expect(created.knowledge_base.subfolder).toBe('notes');

    const updated = await callTool('update_knowledge_base', {
      name: 'kb-tools',
      description: 'Updated description',
    });

    expect(updated.knowledge_base.description).toBe('Updated description');
  });

  it('adds folder constraints via MCP tool', async () => {
    await callTool('add_knowledge_base', {
      name: 'kb-constraints',
      description: 'KB with constraints',
      subfolder: 'docs',
    });

    const result = await callTool('add_knowledge_base_folder_constraint', {
      kb_name: 'kb-constraints',
      subfolder: 'docs',
      rules: {
        frontmatter: {
          required_fields: [{ name: 'title', type: 'string' }],
        },
      },
    });

    expect(result.folder_constraint.subfolder).toBe('docs');
    expect(result.folder_constraint.rules.frontmatter.required_fields).toHaveLength(1);
  });

  it('lists notes in a knowledge base', async () => {
    await callTool('add_knowledge_base', {
      name: 'kb-list',
      description: 'KB list',
      subfolder: 'notes',
    });

    await app.vault.create('notes/a.md', '# A');
    await app.vault.create('notes/sub/b.md', '# B');
    await app.vault.create('notes/sub/c.txt', 'ignore');

    const result = await callTool('list_notes', { knowledge_base_name: 'kb-list' });

    const notePaths = result.notes.map((note: { path: string }) => note.path).sort();
    expect(notePaths).toEqual(['notes/a.md', 'notes/sub/b.md']);
  });

  it('creates and reads notes via MCP tools', async () => {
    await callTool('add_knowledge_base', {
      name: 'kb-notes',
      description: 'KB notes',
      subfolder: 'notes',
    });

    await callTool('add_knowledge_base_folder_constraint', {
      kb_name: 'kb-notes',
      subfolder: 'notes',
      rules: {
        frontmatter: {
          required_fields: [{ name: 'title', type: 'string' }],
        },
      },
    });

    await callTool('create_note', {
      knowledge_base_name: 'kb-notes',
      note_path: 'daily.md',
      note_content: '---\ntitle: Hello\n---\nContent',
    });

    const read = await callTool('read_note', {
      knowledge_base_name: 'kb-notes',
      note_path: 'daily.md',
      offset: 0,
      limit: 5,
    });

    expect(read.path).toBe('notes/daily.md');
    expect(read.content).toBe('---\nt');
  });

  it('updates, appends, moves, and deletes notes via MCP tools', async () => {
    await callTool('add_knowledge_base', {
      name: 'kb-edit',
      description: 'KB edit',
      subfolder: 'notes',
    });

    await app.vault.create('notes/edit.md', 'Hello');

    await callTool('update_note', {
      knowledge_base_name: 'kb-edit',
      note_path: 'edit.md',
      note_content: 'Updated content',
    });

    await callTool('append_note', {
      knowledge_base_name: 'kb-edit',
      note_path: 'edit.md',
      note_content: 'Appendix',
    });

    const updatedFile = app.vault.getAbstractFileByPath('notes/edit.md');
    const updatedContent = updatedFile ? await app.vault.read(updatedFile as any) : '';
    expect(updatedContent).toBe('Updated content\nAppendix');

    await callTool('move_note', {
      knowledge_base_name: 'kb-edit',
      origin_note_path: 'edit.md',
      new_note_path: 'archive/edit.md',
    });

    expect(app.vault.getAbstractFileByPath('notes/edit.md')).toBeNull();
    expect(app.vault.getAbstractFileByPath('notes/archive/edit.md')).not.toBeNull();

    await callTool('delete_note', {
      knowledge_base_name: 'kb-edit',
      note_path: 'archive/edit.md',
    });

    expect(app.vault.getAbstractFileByPath('notes/archive/edit.md')).toBeNull();
  });

  it('lists vault files and searches notes via MCP tools', async () => {
    await app.vault.create('root.md', 'Hello world');
    await app.vault.create('docs/readme.md', 'Search me');
    await app.vault.create('docs/image.png', 'binary');

    const listAll = await callTool('list_vault_files', {});
    expect(listAll.files.sort()).toEqual(['docs/', 'root.md']);

    const listDocs = await callTool('list_vault_files', { path: 'docs' });
    expect(listDocs.files.sort()).toEqual(['docs/image.png', 'docs/readme.md']);

    const search = await callTool('search_vault', { query: 'Search', context_length: 4 });
    expect(search.results).toHaveLength(1);
    expect(search.results[0].path).toBe('docs/readme.md');
    expect(search.results[0].matches[0].context).toContain('Search');
  });

  it('reads active note and executes commands via MCP tools', async () => {
    await app.vault.create('active.md', 'Active content');
    const activeFile = app.vault.getAbstractFileByPath('active.md');

    app.workspace.getActiveFile = () => activeFile as any;
    app.commands.commands = {
      'test-command': { id: 'test-command', name: 'Test Command' },
    };

    let executed = false;
    app.commands.executeCommandById = (id: string) => {
      if (id === 'test-command') {
        executed = true;
        return true;
      }
      return false;
    };

    const active = await callTool('get_active_note', {});
    expect(active.path).toBe('active.md');
    expect(active.content).toBe('Active content');

    const commands = await callTool('list_commands', {});
    expect(commands.commands).toHaveLength(1);
    expect(commands.commands[0].id).toBe('test-command');

    await callTool('execute_command', { command_id: 'test-command' });
    expect(executed).toBe(true);
  });
});
