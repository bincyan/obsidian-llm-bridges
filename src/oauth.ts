/**
 * OAuth 2.1 Implementation for MCP Authorization
 *
 * Implements RFC 6749, RFC 7636 (PKCE), and MCP Authorization Specification
 * https://modelcontextprotocol.io/specification/2025-03-26/basic/authorization
 */

import * as crypto from 'crypto';

// ============================================================================
// OAuth 2.1 Types
// ============================================================================

export interface OAuthClient {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: 'none' | 'client_secret_basic' | 'client_secret_post';
  pkce_required: boolean;
  created_at: string;
  scope?: string;
}

export interface AuthorizationCode {
  code: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: 'S256';
  scope: string;
  expires_at: number;
  user_approved: boolean;
}

export interface AccessToken {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  expires_at: number;
  refresh_token?: string;
  scope: string;
  client_id: string;
}

export interface RefreshToken {
  refresh_token: string;
  client_id: string;
  scope: string;
  expires_at: number;
}

export interface OAuthSettings {
  enabled: boolean;
  clients: OAuthClient[];
  access_token_lifetime: number; // seconds, default 3600 (1 hour)
  refresh_token_lifetime: number; // seconds, default 604800 (7 days)
  authorization_code_lifetime: number; // seconds, default 600 (10 minutes)
}

export const DEFAULT_OAUTH_SETTINGS: OAuthSettings = {
  enabled: false,
  clients: [],
  access_token_lifetime: 3600,
  refresh_token_lifetime: 604800,
  authorization_code_lifetime: 600,
};

// Claude Desktop well-known client (per MCP Authorization Specification)
// This is a PUBLIC client using PKCE - no client_secret required
export const CLAUDE_DESKTOP_CLIENT: OAuthClient = {
  client_id: 'claude-desktop',
  client_name: 'Claude Desktop MCP Connector',
  redirect_uris: [
    'https://claude.ai/api/oauth/callback',  // Claude web callback (exact match required)
    'claude://oauth/callback',                // Claude desktop app deep link (exact match required)
  ],
  grant_types: ['authorization_code'],
  response_types: ['code'],
  token_endpoint_auth_method: 'none',  // Public client - no secret
  pkce_required: true,                  // PKCE with S256 is mandatory
  created_at: new Date().toISOString(),
  scope: 'mcp:read mcp:write',
};

// ============================================================================
// OAuth 2.1 Authorization Server Metadata (RFC 8414)
// ============================================================================

export interface AuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  token_endpoint_auth_methods_supported: string[];
  grant_types_supported: string[];
  response_types_supported: string[];
  code_challenge_methods_supported: string[];
  scopes_supported: string[];
  service_documentation?: string;
}

export function getAuthorizationServerMetadata(baseUrl: string): AuthorizationServerMetadata {
  return {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    token_endpoint_auth_methods_supported: ['none'], // Public clients (PKCE)
    grant_types_supported: ['authorization_code', 'refresh_token'],
    response_types_supported: ['code'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['mcp:read', 'mcp:write', 'mcp:admin'],
    service_documentation: 'https://github.com/bincyan/obsidian-llm-bridges',
  };
}

// ============================================================================
// Protected Resource Metadata (RFC 9728 / MCP Spec)
// ============================================================================

export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  bearer_methods_supported: string[];
  scopes_supported: string[];
}

export function getProtectedResourceMetadata(baseUrl: string): ProtectedResourceMetadata {
  return {
    resource: baseUrl,
    authorization_servers: [baseUrl],
    bearer_methods_supported: ['header'],
    scopes_supported: ['mcp:read', 'mcp:write', 'mcp:admin'],
  };
}

// ============================================================================
// OAuth Manager Class
// ============================================================================

export class OAuthManager {
  private authorizationCodes: Map<string, AuthorizationCode> = new Map();
  private accessTokens: Map<string, AccessToken> = new Map();
  private refreshTokens: Map<string, RefreshToken> = new Map();
  private settings: OAuthSettings;
  private saveCallback: (settings: OAuthSettings) => Promise<void>;

  constructor(
    settings: OAuthSettings,
    saveCallback: (settings: OAuthSettings) => Promise<void>
  ) {
    this.settings = settings;
    this.saveCallback = saveCallback;

    // Pre-register Claude Desktop client if OAuth is enabled
    if (settings.enabled && !settings.clients.find(c => c.client_id === 'claude-desktop')) {
      this.registerClient(CLAUDE_DESKTOP_CLIENT);
    }
  }

  // ============================================================================
  // Client Management
  // ============================================================================

  async registerClient(client: OAuthClient): Promise<OAuthClient> {
    // Check for duplicate
    const existing = this.settings.clients.find(c => c.client_id === client.client_id);
    if (existing) {
      return existing;
    }

    this.settings.clients.push(client);
    await this.saveCallback(this.settings);
    return client;
  }

  getClient(clientId: string): OAuthClient | undefined {
    return this.settings.clients.find(c => c.client_id === clientId);
  }

  validateRedirectUri(clientId: string, redirectUri: string): boolean {
    const client = this.getClient(clientId);
    if (!client) return false;

    // OAuth requires EXACT string match for redirect URIs (security requirement)
    // No trailing slash differences, no port variations - must be identical
    return client.redirect_uris.includes(redirectUri);
  }

  // ============================================================================
  // Authorization Code Flow
  // ============================================================================

  generateAuthorizationCode(
    clientId: string,
    redirectUri: string,
    codeChallenge: string,
    codeChallengeMethod: 'S256',
    scope: string
  ): AuthorizationCode {
    const code = this.generateSecureToken(32);
    const expiresAt = Date.now() + (this.settings.authorization_code_lifetime * 1000);

    const authCode: AuthorizationCode = {
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      code_challenge_method: codeChallengeMethod,
      scope,
      expires_at: expiresAt,
      user_approved: false,
    };

    this.authorizationCodes.set(code, authCode);
    return authCode;
  }

  approveAuthorizationCode(code: string): boolean {
    const authCode = this.authorizationCodes.get(code);
    if (!authCode) return false;

    authCode.user_approved = true;
    return true;
  }

  denyAuthorizationCode(code: string): void {
    this.authorizationCodes.delete(code);
  }

  getAuthorizationCode(code: string): AuthorizationCode | undefined {
    const authCode = this.authorizationCodes.get(code);
    if (!authCode) return undefined;

    // Check expiration
    if (Date.now() > authCode.expires_at) {
      this.authorizationCodes.delete(code);
      return undefined;
    }

    return authCode;
  }

  // ============================================================================
  // Token Exchange
  // ============================================================================

  exchangeCodeForTokens(
    code: string,
    clientId: string,
    redirectUri: string,
    codeVerifier: string
  ): { access_token: AccessToken; refresh_token?: RefreshToken } | { error: string; error_description: string } {
    const authCode = this.getAuthorizationCode(code);

    if (!authCode) {
      return { error: 'invalid_grant', error_description: 'Authorization code not found or expired' };
    }

    if (!authCode.user_approved) {
      return { error: 'access_denied', error_description: 'Authorization not approved by user' };
    }

    if (authCode.client_id !== clientId) {
      return { error: 'invalid_grant', error_description: 'Client ID mismatch' };
    }

    if (authCode.redirect_uri !== redirectUri) {
      return { error: 'invalid_grant', error_description: 'Redirect URI mismatch' };
    }

    // Verify PKCE code_verifier
    if (!this.verifyCodeChallenge(codeVerifier, authCode.code_challenge)) {
      return { error: 'invalid_grant', error_description: 'Invalid code verifier' };
    }

    // Delete used authorization code (one-time use)
    this.authorizationCodes.delete(code);

    // Generate tokens
    const accessToken = this.generateAccessToken(clientId, authCode.scope);
    const refreshToken = this.generateRefreshToken(clientId, authCode.scope);

    // Link refresh token to access token
    accessToken.refresh_token = refreshToken.refresh_token;

    return { access_token: accessToken, refresh_token: refreshToken };
  }

  refreshAccessToken(
    refreshTokenStr: string,
    clientId: string
  ): { access_token: AccessToken; refresh_token?: RefreshToken } | { error: string; error_description: string } {
    const refreshToken = this.refreshTokens.get(refreshTokenStr);

    if (!refreshToken) {
      return { error: 'invalid_grant', error_description: 'Refresh token not found' };
    }

    if (Date.now() > refreshToken.expires_at) {
      this.refreshTokens.delete(refreshTokenStr);
      return { error: 'invalid_grant', error_description: 'Refresh token expired' };
    }

    if (refreshToken.client_id !== clientId) {
      return { error: 'invalid_grant', error_description: 'Client ID mismatch' };
    }

    // Generate new access token
    const newAccessToken = this.generateAccessToken(clientId, refreshToken.scope);

    // Optionally rotate refresh token (recommended for security)
    this.refreshTokens.delete(refreshTokenStr);
    const newRefreshToken = this.generateRefreshToken(clientId, refreshToken.scope);
    newAccessToken.refresh_token = newRefreshToken.refresh_token;

    return { access_token: newAccessToken, refresh_token: newRefreshToken };
  }

  // ============================================================================
  // Token Validation
  // ============================================================================

  validateAccessToken(tokenStr: string): AccessToken | null {
    const token = this.accessTokens.get(tokenStr);

    if (!token) return null;

    if (Date.now() > token.expires_at) {
      this.accessTokens.delete(tokenStr);
      return null;
    }

    return token;
  }

  revokeToken(tokenStr: string): boolean {
    const accessDeleted = this.accessTokens.delete(tokenStr);
    const refreshDeleted = this.refreshTokens.delete(tokenStr);
    return accessDeleted || refreshDeleted;
  }

  revokeAllClientTokens(clientId: string): void {
    for (const [key, token] of this.accessTokens) {
      if (token.client_id === clientId) {
        this.accessTokens.delete(key);
      }
    }
    for (const [key, token] of this.refreshTokens) {
      if (token.client_id === clientId) {
        this.refreshTokens.delete(key);
      }
    }
  }

  // ============================================================================
  // PKCE Helpers
  // ============================================================================

  private verifyCodeChallenge(codeVerifier: string, codeChallenge: string): boolean {
    // S256: BASE64URL(SHA256(code_verifier)) == code_challenge
    const hash = crypto.createHash('sha256').update(codeVerifier).digest();
    const computed = this.base64UrlEncode(hash);
    return computed === codeChallenge;
  }

  private base64UrlEncode(buffer: Buffer): string {
    return buffer
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  // ============================================================================
  // Token Generation
  // ============================================================================

  private generateAccessToken(clientId: string, scope: string): AccessToken {
    const tokenStr = this.generateSecureToken(32);
    const expiresIn = this.settings.access_token_lifetime;
    const expiresAt = Date.now() + (expiresIn * 1000);

    const token: AccessToken = {
      access_token: tokenStr,
      token_type: 'Bearer',
      expires_in: expiresIn,
      expires_at: expiresAt,
      scope,
      client_id: clientId,
    };

    this.accessTokens.set(tokenStr, token);
    return token;
  }

  private generateRefreshToken(clientId: string, scope: string): RefreshToken {
    const tokenStr = this.generateSecureToken(48);
    const expiresAt = Date.now() + (this.settings.refresh_token_lifetime * 1000);

    const token: RefreshToken = {
      refresh_token: tokenStr,
      client_id: clientId,
      scope,
      expires_at: expiresAt,
    };

    this.refreshTokens.set(tokenStr, token);
    return token;
  }

  private generateSecureToken(length: number): string {
    return crypto.randomBytes(length).toString('hex');
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  cleanupExpiredTokens(): void {
    const now = Date.now();

    for (const [key, code] of this.authorizationCodes) {
      if (now > code.expires_at) {
        this.authorizationCodes.delete(key);
      }
    }

    for (const [key, token] of this.accessTokens) {
      if (now > token.expires_at) {
        this.accessTokens.delete(key);
      }
    }

    for (const [key, token] of this.refreshTokens) {
      if (now > token.expires_at) {
        this.refreshTokens.delete(key);
      }
    }
  }

  // ============================================================================
  // Settings Management
  // ============================================================================

  isEnabled(): boolean {
    return this.settings.enabled;
  }

  async setEnabled(enabled: boolean): Promise<void> {
    this.settings.enabled = enabled;

    // Add Claude Desktop client when enabling
    if (enabled && !this.settings.clients.find(c => c.client_id === 'claude-desktop')) {
      this.settings.clients.push({
        ...CLAUDE_DESKTOP_CLIENT,
        created_at: new Date().toISOString(),
      });
    }

    await this.saveCallback(this.settings);
  }

  getSettings(): OAuthSettings {
    return { ...this.settings };
  }

  async updateSettings(updates: Partial<OAuthSettings>): Promise<void> {
    this.settings = { ...this.settings, ...updates };
    await this.saveCallback(this.settings);
  }

  // Get pending authorization requests for UI
  getPendingAuthorizations(): AuthorizationCode[] {
    const pending: AuthorizationCode[] = [];
    const now = Date.now();

    for (const code of this.authorizationCodes.values()) {
      if (!code.user_approved && now < code.expires_at) {
        pending.push(code);
      }
    }

    return pending;
  }
}

// ============================================================================
// HTML Templates for OAuth UI
// ============================================================================

export function getAuthorizationPageHtml(
  clientName: string,
  scope: string,
  code: string,
  redirectUri: string,
  state?: string
): string {
  const scopeDescriptions: Record<string, string> = {
    'mcp:read': 'Read your notes and vault structure',
    'mcp:write': 'Create, update, and delete notes',
    'mcp:admin': 'Full administrative access',
  };

  const scopes = scope.split(' ').filter(s => s);
  const scopeList = scopes
    .map(s => `<li>${scopeDescriptions[s] || s}</li>`)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorize - LLM Bridges</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0;
      padding: 20px;
    }
    .card {
      background: white;
      border-radius: 16px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
      max-width: 420px;
      width: 100%;
      padding: 40px;
    }
    .logo {
      width: 64px;
      height: 64px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 24px;
      font-size: 32px;
    }
    h1 {
      color: #1a1a2e;
      font-size: 24px;
      text-align: center;
      margin: 0 0 8px;
    }
    .client-name {
      color: #667eea;
      font-weight: 600;
    }
    .subtitle {
      color: #6b7280;
      text-align: center;
      margin-bottom: 24px;
    }
    .permissions {
      background: #f3f4f6;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 24px;
    }
    .permissions h3 {
      color: #374151;
      font-size: 14px;
      margin: 0 0 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .permissions ul {
      margin: 0;
      padding-left: 20px;
      color: #4b5563;
    }
    .permissions li {
      margin-bottom: 8px;
    }
    .buttons {
      display: flex;
      gap: 12px;
    }
    button {
      flex: 1;
      padding: 14px 24px;
      border-radius: 10px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    .approve {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
    }
    .approve:hover {
      transform: translateY(-2px);
      box-shadow: 0 10px 20px -10px rgba(102, 126, 234, 0.5);
    }
    .deny {
      background: white;
      color: #6b7280;
      border: 2px solid #e5e7eb;
    }
    .deny:hover {
      border-color: #d1d5db;
      background: #f9fafb;
    }
    .warning {
      background: #fef3c7;
      border-left: 4px solid #f59e0b;
      padding: 12px 16px;
      border-radius: 0 8px 8px 0;
      margin-bottom: 24px;
      font-size: 14px;
      color: #92400e;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">🔗</div>
    <h1>Authorize <span class="client-name">${escapeHtml(clientName)}</span></h1>
    <p class="subtitle">wants to access your Obsidian vault</p>

    <div class="warning">
      Only authorize applications you trust. This will grant access to your notes.
    </div>

    <div class="permissions">
      <h3>Permissions Requested</h3>
      <ul>
        ${scopeList}
      </ul>
    </div>

    <form method="POST" action="/oauth/authorize/decision">
      <input type="hidden" name="code" value="${escapeHtml(code)}">
      <input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}">
      ${state ? `<input type="hidden" name="state" value="${escapeHtml(state)}">` : ''}

      <div class="buttons">
        <button type="submit" name="decision" value="deny" class="deny">Deny</button>
        <button type="submit" name="decision" value="approve" class="approve">Authorize</button>
      </div>
    </form>
  </div>
</body>
</html>`;
}

export function getErrorPageHtml(error: string, description: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Error - LLM Bridges</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f3f4f6;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0;
      padding: 20px;
    }
    .card {
      background: white;
      border-radius: 16px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
      max-width: 400px;
      padding: 40px;
      text-align: center;
    }
    .icon {
      font-size: 48px;
      margin-bottom: 16px;
    }
    h1 {
      color: #dc2626;
      font-size: 20px;
      margin: 0 0 12px;
    }
    p {
      color: #6b7280;
      margin: 0;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">❌</div>
    <h1>${escapeHtml(error)}</h1>
    <p>${escapeHtml(description)}</p>
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
