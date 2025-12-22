import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { OpenAPIServer, DEFAULT_OPENAPI_SETTINGS } from '../../src/openapi';

describe('OpenAPI server', () => {
  let server: OpenAPIServer;

  const requestJson = (
    url: string,
    options: http.RequestOptions = {},
    body?: string
  ): Promise<{ status: number; json: any }> => {
    return new Promise((resolve, reject) => {
      const req = http.request(url, options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          const text = data || '{}';
          resolve({ status: res.statusCode || 0, json: JSON.parse(text) });
        });
      });
      req.on('error', reject);
      if (body) {
        req.write(body);
      }
      req.end();
    });
  };

  const startServer = async () => {
    server.start();
    const httpServer = (server as any).server as http.Server;
    if (!httpServer.listening) {
      await new Promise<void>((resolve) => httpServer.once('listening', resolve));
    }
    const address = httpServer.address() as AddressInfo;
    return { port: address.port };
  };

  beforeEach(() => {
    server = new OpenAPIServer(
      { ...DEFAULT_OPENAPI_SETTINGS, enabled: true, port: 0 },
      '127.0.0.1',
      '',
      async (_name, args) => ({ ok: true, args }),
      (authHeader) => ({
        authenticated: authHeader === 'Bearer test-token',
        error: 'Unauthorized',
      }),
      () => ({ name: 'test-vault', version: '0.0.0' })
    );
    server.setTools([
      {
        name: 'list_knowledge_bases',
        description: 'List KBs',
        inputSchema: { type: 'object', properties: {}, required: [] },
      },
    ]);
  });

  afterEach(() => {
    server.stop();
  });

  it('serves OpenAPI spec on public endpoint', async () => {
    const { port } = await startServer();
    const response = await requestJson(`http://127.0.0.1:${port}/openapi.json`);

    expect(response.status).toBe(200);
    expect(response.json.paths['/api/list-knowledge-bases']).toBeDefined();
  });

  it('rejects unauthorized requests to tool endpoints', async () => {
    const { port } = await startServer();
    const response = await requestJson(`http://127.0.0.1:${port}/api/list-knowledge-bases`);

    expect(response.status).toBe(401);
    expect(response.json.error).toBe('unauthorized');
  });

  it('executes tool endpoints with authentication', async () => {
    const { port } = await startServer();
    const response = await requestJson(`http://127.0.0.1:${port}/api/list-knowledge-bases`, {
      headers: { Authorization: 'Bearer test-token' },
    });

    expect(response.status).toBe(200);
    expect(response.json.success).toBe(true);
    expect(response.json.data.ok).toBe(true);
  });
});
