import { describe, it, expect, beforeEach } from 'vitest';
import LLMBridgesPlugin from '../../src/main';
import { KBManager } from '../../src/kb-manager';
import { createMockApp } from '../mocks/obsidian';

describe('MCP request handler', () => {
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

  const callRequest = async (method: string, params?: Record<string, unknown>) => {
    return plugin.handleMCPRequest({
      jsonrpc: '2.0',
      id: 'req-1',
      method,
      params,
    });
  };

  beforeEach(() => {
    app = createMockApp();
    plugin = new LLMBridgesPlugin(app as any, manifest as any);
    plugin.kbManager = new KBManager(app as any);
  });

  it('handles initialize and tools/list', async () => {
    const init = await callRequest('initialize');
    expect(init.result).toBeDefined();
    expect((init.result as any).serverInfo.name).toBe('obsidian-llm-bridges');

    const tools = await callRequest('tools/list');
    expect((tools.result as any).tools.length).toBeGreaterThan(0);
  });

  it('handles resources/list and resources/read', async () => {
    await app.vault.create('a.md', 'A');
    await app.vault.create('b.md', 'B');
    await app.vault.create('c.txt', 'C');

    const list = await callRequest('resources/list');
    expect((list.result as any).resources.length).toBeGreaterThan(0);

    await plugin.kbManager.addKnowledgeBase('kb', 'KB', 'notes', 'Rules');
    const readVault = await callRequest('resources/read', { uri: 'obsidian://vault' });
    const vaultText = (readVault.result as any).contents[0].text;
    expect(JSON.parse(vaultText).files).toBe(3);

    const readKbs = await callRequest('resources/read', { uri: 'obsidian://knowledge-bases' });
    const kbsText = (readKbs.result as any).contents[0].text;
    expect(JSON.parse(kbsText).knowledge_bases).toHaveLength(1);
  });

  it('returns an error for unknown methods', async () => {
    const response = await callRequest('unknown/method');
    expect(response.error?.code).toBe(-32601);
  });
});
