/**
 * Tests for the config system
 *
 * Architecture under test:
 *   Server-side: getServerConfig() reads process.env → returns Config.
 *   Client-side: window.__APP_CONFIG__ injected by root layout <script>.
 *   Universal:   getConfig(key) and `config` export work in both environments.
 *   Security:    getClientConfigScript() XSS-escapes the JSON payload.
 *
 * Test strategy:
 *   - Server tests: manipulate process.env, call getServerConfig().
 *   - Client tests: set window.__APP_CONFIG__, call getConfig() / config.
 *   - Security tests: inject malicious env var values, verify XSS escaping.
 *   - Edge cases: empty strings, undefined, partial config, type coercion.
 */

import {
  getServerConfig,
  getConfig,
  getLogoFilterClass,
  getClientConfigScript,
  config,
} from '../config';
import type { Config } from '../config';

// ==========================================================================
// Helpers
// ==========================================================================

/** Typed accessor for window.__APP_CONFIG__ */
const getWindowConfig = () =>
  (window as unknown as { __APP_CONFIG__?: Config }).__APP_CONFIG__;

const setWindowConfig = (cfg: Config | undefined) => {
  (window as unknown as { __APP_CONFIG__?: Config }).__APP_CONFIG__ = cfg;
};

/** Clean env helper: delete both prefixed and non-prefixed versions */
function clearEnv(...names: string[]) {
  for (const name of names) {
    delete process.env[name];
    delete process.env[`NEXT_PUBLIC_${name}`];
  }
}

// ==========================================================================
// Server-Side Tests (getServerConfig)
// ==========================================================================

describe('getServerConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // ---------- Default values ----------

  describe('defaults (no env vars set)', () => {
    beforeEach(() => {
      // Clear ALL env vars that the config reads
      clearEnv(
        'A2A_BASE_URL', 'RAG_URL', 'SSO_ENABLED', 'RAG_ENABLED',
        'MONGODB_ENABLED', 'PREVIEW_MODE',
        'ALLOW_DEV_ADMIN_WHEN_SSO_DISABLED', 'SHOW_POWERED_BY',
        'LOGO_STYLE', 'SPINNER_COLOR', 'TAGLINE', 'DESCRIPTION',
        'APP_NAME', 'LOGO_URL', 'GRADIENT_FROM', 'GRADIENT_TO',
        'SUPPORT_EMAIL',
      );
      delete process.env.MONGODB_URI;
      delete process.env.MONGODB_DATABASE;
      delete process.env.RAG_SERVER_URL;
    });

    it('should return all expected default values', () => {
      const cfg = getServerConfig();

      expect(cfg.caipeUrl).toBe('http://localhost:8000');
      expect(cfg.ragUrl).toBe('http://localhost:9446');
      expect(cfg.isDev).toBe(false);
      expect(cfg.isProd).toBe(false);
      expect(cfg.ssoEnabled).toBe(false);
      expect(cfg.ragEnabled).toBe(true); // default true
      expect(cfg.mongodbEnabled).toBe(false);
      expect(cfg.tagline).toBe('Multi-Agent Workflow Automation');
      expect(cfg.description).toBe(
        'Where Humans and AI agents collaborate to deliver high quality outcomes.',
      );
      expect(cfg.appName).toBe('CAIPE');
      expect(cfg.logoUrl).toBe('/logo.svg');
      expect(cfg.previewMode).toBe(false);
      expect(cfg.gradientFrom).toBe('hsl(173,80%,40%)');
      expect(cfg.gradientTo).toBe('hsl(270,75%,60%)');
      expect(cfg.logoStyle).toBe('default');
      expect(cfg.spinnerColor).toBeNull();
      expect(cfg.showPoweredBy).toBe(true);
      expect(cfg.supportEmail).toBe('support@example.com');
      expect(cfg.allowDevAdminWhenSsoDisabled).toBe(false);
      expect(cfg.storageMode).toBe('localStorage');
    });

    it('should have exactly the expected Config keys (no extras)', () => {
      const cfg = getServerConfig();
      const expectedKeys: (keyof Config)[] = [
        'caipeUrl', 'ragUrl', 'isDev', 'isProd', 'ssoEnabled',
        'ragEnabled', 'mongodbEnabled',
        'tagline', 'description', 'appName', 'logoUrl', 'previewMode',
        'gradientFrom', 'gradientTo', 'logoStyle', 'spinnerColor',
        'showPoweredBy', 'supportEmail', 'allowDevAdminWhenSsoDisabled',
        'storageMode', 'enabledIntegrationIcons', 'faviconUrl',
        'docsUrl', 'sourceUrl', 'workflowRunnerEnabled',
      ];
      expect(Object.keys(cfg).sort()).toEqual(expectedKeys.sort());
    });
  });

  // ---------- Custom env vars (new names) ----------

  describe('custom env vars (clean names)', () => {
    it('should read SSO_ENABLED=true', () => {
      process.env.SSO_ENABLED = 'true';
      expect(getServerConfig().ssoEnabled).toBe(true);
    });

    it('should treat SSO_ENABLED=false as false', () => {
      process.env.SSO_ENABLED = 'false';
      expect(getServerConfig().ssoEnabled).toBe(false);
    });

    it('should treat SSO_ENABLED=1 as false (strict true check)', () => {
      process.env.SSO_ENABLED = '1';
      expect(getServerConfig().ssoEnabled).toBe(false);
    });

    it('should read A2A_BASE_URL', () => {
      process.env.A2A_BASE_URL = 'https://my-supervisor:8000';
      expect(getServerConfig().caipeUrl).toBe('https://my-supervisor:8000');
    });

    it('should read RAG_URL', () => {
      process.env.RAG_URL = 'https://rag.internal:9446';
      expect(getServerConfig().ragUrl).toBe('https://rag.internal:9446');
    });

    it('should fall back to RAG_SERVER_URL', () => {
      clearEnv('RAG_URL');
      process.env.RAG_SERVER_URL = 'https://legacy-rag:9446';
      expect(getServerConfig().ragUrl).toBe('https://legacy-rag:9446');
    });

    it('should read APP_NAME', () => {
      process.env.APP_NAME = 'Grid';
      expect(getServerConfig().appName).toBe('Grid');
    });

    it('should read LOGO_URL', () => {
      process.env.LOGO_URL = '/grid-neon-logo.svg';
      expect(getServerConfig().logoUrl).toBe('/grid-neon-logo.svg');
    });

    it('should read TAGLINE', () => {
      process.env.TAGLINE = 'Custom Tagline';
      expect(getServerConfig().tagline).toBe('Custom Tagline');
    });

    it('should read DESCRIPTION', () => {
      process.env.DESCRIPTION = 'A custom description for testing.';
      expect(getServerConfig().description).toBe('A custom description for testing.');
    });

    it('should read PREVIEW_MODE=true', () => {
      process.env.PREVIEW_MODE = 'true';
      expect(getServerConfig().previewMode).toBe(true);
    });

    it('should read ALLOW_DEV_ADMIN_WHEN_SSO_DISABLED=true', () => {
      process.env.ALLOW_DEV_ADMIN_WHEN_SSO_DISABLED = 'true';
      expect(getServerConfig().allowDevAdminWhenSsoDisabled).toBe(true);
    });

    it('should read SUPPORT_EMAIL', () => {
      process.env.SUPPORT_EMAIL = 'admin@cisco.com';
      expect(getServerConfig().supportEmail).toBe('admin@cisco.com');
    });

    it('should read SPINNER_COLOR', () => {
      process.env.SPINNER_COLOR = '#ff6600';
      expect(getServerConfig().spinnerColor).toBe('#ff6600');
    });

    it('should read GRADIENT_FROM and GRADIENT_TO', () => {
      process.env.GRADIENT_FROM = '#ff0000';
      process.env.GRADIENT_TO = '#0000ff';
      const cfg = getServerConfig();
      expect(cfg.gradientFrom).toBe('#ff0000');
      expect(cfg.gradientTo).toBe('#0000ff');
    });
  });

  // ---------- MongoDB / storageMode ----------

  describe('MongoDB and storageMode', () => {
    beforeEach(() => {
      delete process.env.MONGODB_URI;
      delete process.env.MONGODB_DATABASE;
      clearEnv('MONGODB_ENABLED');
    });

    it('should return localStorage when MongoDB not configured', () => {
      const cfg = getServerConfig();
      expect(cfg.mongodbEnabled).toBe(false);
      expect(cfg.storageMode).toBe('localStorage');
    });

    it('should enable mongodb when MONGODB_URI + MONGODB_DATABASE set', () => {
      process.env.MONGODB_URI = 'mongodb://localhost:27017';
      process.env.MONGODB_DATABASE = 'caipe';
      const cfg = getServerConfig();
      expect(cfg.mongodbEnabled).toBe(true);
      expect(cfg.storageMode).toBe('mongodb');
    });

    it('should NOT enable mongodb when only MONGODB_URI is set', () => {
      process.env.MONGODB_URI = 'mongodb://localhost:27017';
      const cfg = getServerConfig();
      expect(cfg.mongodbEnabled).toBe(false);
      expect(cfg.storageMode).toBe('localStorage');
    });

    it('should NOT enable mongodb when only MONGODB_DATABASE is set', () => {
      process.env.MONGODB_DATABASE = 'caipe';
      const cfg = getServerConfig();
      expect(cfg.mongodbEnabled).toBe(false);
      expect(cfg.storageMode).toBe('localStorage');
    });

    it('should enable mongodb via MONGODB_ENABLED=true even without URI', () => {
      process.env.MONGODB_ENABLED = 'true';
      const cfg = getServerConfig();
      expect(cfg.mongodbEnabled).toBe(true);
      expect(cfg.storageMode).toBe('mongodb');
    });

    it('should enable mongodb via NEXT_PUBLIC_MONGODB_ENABLED=true', () => {
      process.env.NEXT_PUBLIC_MONGODB_ENABLED = 'true';
      const cfg = getServerConfig();
      expect(cfg.mongodbEnabled).toBe(true);
    });
  });

  // ---------- RAG enabled ----------

  describe('ragEnabled', () => {
    beforeEach(() => clearEnv('RAG_ENABLED'));

    it('should default to true (enabled)', () => {
      expect(getServerConfig().ragEnabled).toBe(true);
    });

    it('should be false when RAG_ENABLED=false', () => {
      process.env.RAG_ENABLED = 'false';
      expect(getServerConfig().ragEnabled).toBe(false);
    });

    it('should be true for RAG_ENABLED=true', () => {
      process.env.RAG_ENABLED = 'true';
      expect(getServerConfig().ragEnabled).toBe(true);
    });

    it('should be true for RAG_ENABLED=anything (only "false" disables)', () => {
      process.env.RAG_ENABLED = 'banana';
      expect(getServerConfig().ragEnabled).toBe(true);
    });
  });

  // ---------- Logo style ----------

  describe('logoStyle', () => {
    beforeEach(() => clearEnv('LOGO_STYLE'));

    it('should default to "default"', () => {
      expect(getServerConfig().logoStyle).toBe('default');
    });

    it('should accept "white"', () => {
      process.env.LOGO_STYLE = 'white';
      expect(getServerConfig().logoStyle).toBe('white');
    });

    it('should fall back to "default" for invalid values', () => {
      process.env.LOGO_STYLE = 'blue';
      expect(getServerConfig().logoStyle).toBe('default');
    });

    it('should fall back to "default" for empty string', () => {
      process.env.LOGO_STYLE = '';
      expect(getServerConfig().logoStyle).toBe('default');
    });
  });

  // ---------- showPoweredBy ----------

  describe('showPoweredBy', () => {
    beforeEach(() => clearEnv('SHOW_POWERED_BY'));

    it('should default to true', () => {
      expect(getServerConfig().showPoweredBy).toBe(true);
    });

    it('should be false when SHOW_POWERED_BY=false', () => {
      process.env.SHOW_POWERED_BY = 'false';
      expect(getServerConfig().showPoweredBy).toBe(false);
    });

    it('should be true when SHOW_POWERED_BY=true', () => {
      process.env.SHOW_POWERED_BY = 'true';
      expect(getServerConfig().showPoweredBy).toBe(true);
    });

    it('should be true for SHOW_POWERED_BY=anything (only "false" disables)', () => {
      process.env.SHOW_POWERED_BY = '0';
      expect(getServerConfig().showPoweredBy).toBe(true);
    });
  });

  // ---------- NODE_ENV / isDev / isProd ----------

  describe('NODE_ENV detection', () => {
    it('should set isDev=true in development', () => {
      process.env.NODE_ENV = 'development';
      const cfg = getServerConfig();
      expect(cfg.isDev).toBe(true);
      expect(cfg.isProd).toBe(false);
    });

    it('should set isProd=true in production', () => {
      process.env.NODE_ENV = 'production';
      const cfg = getServerConfig();
      expect(cfg.isDev).toBe(false);
      expect(cfg.isProd).toBe(true);
    });

    it('should set both false in test environment', () => {
      process.env.NODE_ENV = 'test';
      const cfg = getServerConfig();
      expect(cfg.isDev).toBe(false);
      expect(cfg.isProd).toBe(false);
    });
  });

  // ---------- Production defaults ----------

  describe('production defaults (when no A2A/RAG URL set)', () => {
    it('should use k8s service URLs for caipeUrl in production', () => {
      process.env.NODE_ENV = 'production';
      clearEnv('A2A_BASE_URL');
      expect(getServerConfig().caipeUrl).toBe('http://caipe-supervisor:8000');
    });

    it('should use k8s service URLs for ragUrl in production', () => {
      process.env.NODE_ENV = 'production';
      clearEnv('RAG_URL');
      delete process.env.RAG_SERVER_URL;
      expect(getServerConfig().ragUrl).toBe('http://rag-server:9446');
    });
  });

  // ---------- Backward compatibility (NEXT_PUBLIC_ prefix) ----------

  describe('backward compatibility (NEXT_PUBLIC_ prefix)', () => {
    it('should read NEXT_PUBLIC_SSO_ENABLED as fallback', () => {
      clearEnv('SSO_ENABLED');
      process.env.NEXT_PUBLIC_SSO_ENABLED = 'true';
      expect(getServerConfig().ssoEnabled).toBe(true);
    });

    it('should read NEXT_PUBLIC_APP_NAME as fallback', () => {
      clearEnv('APP_NAME');
      process.env.NEXT_PUBLIC_APP_NAME = 'LegacyApp';
      expect(getServerConfig().appName).toBe('LegacyApp');
    });

    it('should prefer non-prefixed over NEXT_PUBLIC_', () => {
      process.env.APP_NAME = 'NewName';
      process.env.NEXT_PUBLIC_APP_NAME = 'OldName';
      expect(getServerConfig().appName).toBe('NewName');
    });

    it('should read NEXT_PUBLIC_TAGLINE as fallback', () => {
      clearEnv('TAGLINE');
      process.env.NEXT_PUBLIC_TAGLINE = 'Legacy Tagline';
      expect(getServerConfig().tagline).toBe('Legacy Tagline');
    });

    it('should read NEXT_PUBLIC_LOGO_STYLE as fallback', () => {
      clearEnv('LOGO_STYLE');
      process.env.NEXT_PUBLIC_LOGO_STYLE = 'white';
      expect(getServerConfig().logoStyle).toBe('white');
    });

    it('should read NEXT_PUBLIC_GRADIENT_FROM as fallback', () => {
      clearEnv('GRADIENT_FROM');
      process.env.NEXT_PUBLIC_GRADIENT_FROM = '#aabbcc';
      expect(getServerConfig().gradientFrom).toBe('#aabbcc');
    });
  });
});

// ==========================================================================
// XSS / Security Tests (getClientConfigScript)
// ==========================================================================

describe('getClientConfigScript (XSS safety)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return valid JSON', () => {
    const script = getClientConfigScript();
    // The script has \u003c which JSON.parse handles natively
    const parsed = JSON.parse(script);
    expect(parsed).toBeDefined();
    expect(typeof parsed.appName).toBe('string');
  });

  it('should escape < to \\u003c to prevent script injection', () => {
    process.env.APP_NAME = '<script>alert("xss")</script>';
    const script = getClientConfigScript();
    // Must NOT contain raw < character
    expect(script).not.toContain('<');
    // Must contain the escaped version
    expect(script).toContain('\\u003c');
  });

  it('should handle </script> injection attempt', () => {
    process.env.TAGLINE = '</script><script>document.location="evil.com"</script>';
    const script = getClientConfigScript();
    expect(script).not.toContain('</script>');
    expect(script).not.toContain('<script>');
    // Should still parse to the original value
    const parsed = JSON.parse(script);
    expect(parsed.tagline).toBe('</script><script>document.location="evil.com"</script>');
  });

  it('should handle event handler injection via <img onerror>', () => {
    process.env.DESCRIPTION = '<img src=x onerror=alert(1)>';
    const script = getClientConfigScript();
    expect(script).not.toContain('<img');
    const parsed = JSON.parse(script);
    expect(parsed.description).toBe('<img src=x onerror=alert(1)>');
  });

  it('should safely handle values with quotes and special chars', () => {
    process.env.APP_NAME = 'He said "hello" & she \'waved\'';
    const script = getClientConfigScript();
    const parsed = JSON.parse(script);
    expect(parsed.appName).toBe('He said "hello" & she \'waved\'');
  });

  it('should handle unicode and emoji in values', () => {
    process.env.TAGLINE = '🚀 AI Platform — línea de trabajo 日本語';
    const script = getClientConfigScript();
    const parsed = JSON.parse(script);
    expect(parsed.tagline).toBe('🚀 AI Platform — línea de trabajo 日本語');
  });

  it('should handle empty string values', () => {
    process.env.APP_NAME = '';
    const script = getClientConfigScript();
    const parsed = JSON.parse(script);
    // Empty string is falsy, so default should be used
    expect(parsed.appName).toBe('CAIPE');
  });

  it('should NOT include server-only secrets', () => {
    // These vars should never appear in the client config
    process.env.OIDC_CLIENT_SECRET = 'super-secret-123';
    process.env.MONGODB_URI = 'mongodb://user:password@host:27017/db';
    process.env.NEXTAUTH_SECRET = 'jwt-secret-456';
    process.env.MONGODB_DATABASE = 'caipe';

    const script = getClientConfigScript();
    expect(script).not.toContain('super-secret-123');
    expect(script).not.toContain('user:password');
    expect(script).not.toContain('jwt-secret-456');
    // The full URI should not be present (only boolean mongodbEnabled)
    expect(script).not.toContain('mongodb://');
  });

  it('should only contain Config interface keys', () => {
    const script = getClientConfigScript();
    const parsed = JSON.parse(script);
    const expectedKeys: (keyof Config)[] = [
      'caipeUrl', 'ragUrl', 'isDev', 'isProd', 'ssoEnabled',
      'ragEnabled', 'mongodbEnabled',
      'tagline', 'description', 'appName', 'logoUrl', 'previewMode',
      'gradientFrom', 'gradientTo', 'logoStyle', 'spinnerColor',
      'showPoweredBy', 'supportEmail', 'allowDevAdminWhenSsoDisabled',
      'storageMode', 'enabledIntegrationIcons', 'faviconUrl',
      'docsUrl', 'sourceUrl', 'workflowRunnerEnabled',
    ];
    expect(Object.keys(parsed).sort()).toEqual(expectedKeys.sort());
  });
});

// ==========================================================================
// Client-Side Tests (window.__APP_CONFIG__, getConfig, config proxy)
// ==========================================================================

describe('client-side config (window.__APP_CONFIG__)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    // Clear any previous window config
    setWindowConfig(undefined);
  });

  afterEach(() => {
    process.env = originalEnv;
    setWindowConfig(undefined);
  });

  describe('getConfig() on the client', () => {
    it('should return default values when window.__APP_CONFIG__ is not set', () => {
      expect(getWindowConfig()).toBeUndefined();
      // In jsdom, window is defined, so getConfig reads from window
      expect(getConfig('appName')).toBe('CAIPE');
      expect(getConfig('ssoEnabled')).toBe(false);
      expect(getConfig('storageMode')).toBe('localStorage');
    });

    it('should return injected values when window.__APP_CONFIG__ is set', () => {
      setWindowConfig({
        caipeUrl: 'https://prod.example.com',
        ragUrl: 'https://rag.example.com',
        isDev: false,
        isProd: true,
        ssoEnabled: true,
        ragEnabled: true,
        mongodbEnabled: true,
        tagline: 'Prod Tagline',
        description: 'Prod Description',
        appName: 'ProdApp',
        logoUrl: '/prod-logo.svg',
        previewMode: false,
        gradientFrom: '#111',
        gradientTo: '#222',
        logoStyle: 'white',
        spinnerColor: '#00ff00',
        showPoweredBy: false,
        supportEmail: 'prod@example.com',
        allowDevAdminWhenSsoDisabled: false,
        storageMode: 'mongodb',
      });

      expect(getConfig('appName')).toBe('ProdApp');
      expect(getConfig('ssoEnabled')).toBe(true);
      expect(getConfig('storageMode')).toBe('mongodb');
      expect(getConfig('logoStyle')).toBe('white');
      expect(getConfig('showPoweredBy')).toBe(false);
      expect(getConfig('spinnerColor')).toBe('#00ff00');
      expect(getConfig('isProd')).toBe(true);
    });

    it('should reflect changes when window.__APP_CONFIG__ is updated', () => {
      // Simulate initial load
      setWindowConfig({
        caipeUrl: 'http://localhost:8000',
        ragUrl: 'http://localhost:9446',
        isDev: true, isProd: false,
        ssoEnabled: false, ragEnabled: true,
        mongodbEnabled: false,
        tagline: 'Dev', description: 'Dev', appName: 'DevApp',
        logoUrl: '/logo.svg', previewMode: false,
        gradientFrom: '#000', gradientTo: '#fff',
        logoStyle: 'default', spinnerColor: null,
        showPoweredBy: true, supportEmail: 'dev@test.com',
        allowDevAdminWhenSsoDisabled: true, storageMode: 'localStorage',
      });

      expect(getConfig('appName')).toBe('DevApp');

      // Update (e.g., hot reload scenario)
      setWindowConfig({
        ...getWindowConfig()!,
        appName: 'UpdatedApp',
        ssoEnabled: true,
      });

      expect(getConfig('appName')).toBe('UpdatedApp');
      expect(getConfig('ssoEnabled')).toBe(true);
    });
  });

  describe('config proxy on the client', () => {
    it('should read from window.__APP_CONFIG__ via proxy', () => {
      setWindowConfig({
        caipeUrl: 'https://proxy-test.com',
        ragUrl: 'https://rag.test.com',
        isDev: false, isProd: true,
        ssoEnabled: true, ragEnabled: false,
        mongodbEnabled: true,
        tagline: 'Proxy Test', description: 'Test',
        appName: 'ProxyApp', logoUrl: '/proxy.svg',
        previewMode: true, gradientFrom: '#aaa', gradientTo: '#bbb',
        logoStyle: 'white', spinnerColor: '#ccc',
        showPoweredBy: false, supportEmail: 'proxy@test.com',
        allowDevAdminWhenSsoDisabled: false, storageMode: 'mongodb',
      });

      // config is a Proxy in jsdom (window is defined)
      expect(config.appName).toBe('ProxyApp');
      expect(config.ssoEnabled).toBe(true);
      expect(config.logoStyle).toBe('white');
      expect(config.storageMode).toBe('mongodb');
    });

    it('should return defaults when window.__APP_CONFIG__ is missing', () => {
      setWindowConfig(undefined);
      expect(config.appName).toBe('CAIPE');
      expect(config.ssoEnabled).toBe(false);
      expect(config.ragEnabled).toBe(true);
    });
  });
});

// ==========================================================================
// getLogoFilterClass Tests
// ==========================================================================

describe('getLogoFilterClass', () => {
  beforeEach(() => {
    setWindowConfig(undefined);
  });

  afterEach(() => {
    setWindowConfig(undefined);
  });

  it('should return empty string for "default" style', () => {
    expect(getLogoFilterClass('default')).toBe('');
  });

  it('should return "brightness-0 invert" for "white" style', () => {
    expect(getLogoFilterClass('white')).toBe('brightness-0 invert');
  });

  it('should read logoStyle from config when no argument provided', () => {
    // Default config has logoStyle='default'
    expect(getLogoFilterClass()).toBe('');
  });

  it('should use window.__APP_CONFIG__ logoStyle when available', () => {
    setWindowConfig({
      caipeUrl: '', ragUrl: '', isDev: false, isProd: false,
      ssoEnabled: false, ragEnabled: true, mongodbEnabled: false,
      tagline: '', description: '',
      appName: '', logoUrl: '', previewMode: false,
      gradientFrom: '', gradientTo: '', logoStyle: 'white',
      spinnerColor: null, showPoweredBy: true, supportEmail: '',
      allowDevAdminWhenSsoDisabled: false, storageMode: 'localStorage',
    });
    expect(getLogoFilterClass()).toBe('brightness-0 invert');
  });
});

// ==========================================================================
// Edge Cases & Robustness Tests
// ==========================================================================

describe('edge cases', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    setWindowConfig(undefined);
  });

  afterEach(() => {
    process.env = originalEnv;
    setWindowConfig(undefined);
  });

  describe('env var edge cases', () => {
    it('should handle env var set to empty string (falls back to default)', () => {
      process.env.TAGLINE = '';
      // Empty string is falsy, falls through to default
      expect(getServerConfig().tagline).toBe('Multi-Agent Workflow Automation');
    });

    it('should handle env var with whitespace-only value', () => {
      process.env.APP_NAME = '   ';
      // Whitespace is truthy, so it gets used
      expect(getServerConfig().appName).toBe('   ');
    });

    it('should handle boolean env with whitespace around true', () => {
      process.env.SSO_ENABLED = ' true ';
      // Strict equality check, so whitespace-padded "true" is NOT true
      expect(getServerConfig().ssoEnabled).toBe(false);
    });

    it('should handle boolean env with uppercase TRUE', () => {
      process.env.SSO_ENABLED = 'TRUE';
      // Strict equality check against 'true' (lowercase)
      expect(getServerConfig().ssoEnabled).toBe(false);
    });

    it('should handle very long env var values', () => {
      const longValue = 'A'.repeat(10000);
      process.env.TAGLINE = longValue;
      expect(getServerConfig().tagline).toBe(longValue);
      expect(getServerConfig().tagline.length).toBe(10000);
    });

    it('should handle env vars with newlines', () => {
      process.env.DESCRIPTION = 'Line 1\nLine 2\nLine 3';
      const cfg = getServerConfig();
      expect(cfg.description).toBe('Line 1\nLine 2\nLine 3');
    });

    it('should handle env vars with backslashes', () => {
      process.env.APP_NAME = 'Path\\To\\App';
      expect(getServerConfig().appName).toBe('Path\\To\\App');
    });

    it('should handle env vars with JSON-like content', () => {
      process.env.TAGLINE = '{"key":"value"}';
      const script = getClientConfigScript();
      const parsed = JSON.parse(script);
      expect(parsed.tagline).toBe('{"key":"value"}');
    });
  });

  describe('Config type safety', () => {
    it('getConfig should return correct types for boolean keys', () => {
      const sso: boolean = getConfig('ssoEnabled');
      expect(typeof sso).toBe('boolean');

      const rag: boolean = getConfig('ragEnabled');
      expect(typeof rag).toBe('boolean');

      const mongo: boolean = getConfig('mongodbEnabled');
      expect(typeof mongo).toBe('boolean');
    });

    it('getConfig should return correct types for string keys', () => {
      const name: string = getConfig('appName');
      expect(typeof name).toBe('string');

      const url: string = getConfig('caipeUrl');
      expect(typeof url).toBe('string');
    });

    it('getConfig should return correct type for nullable keys', () => {
      const spinner: string | null = getConfig('spinnerColor');
      expect(spinner === null || typeof spinner === 'string').toBe(true);
    });

    it('getConfig should return correct type for union keys', () => {
      const mode: 'mongodb' | 'localStorage' = getConfig('storageMode');
      expect(['mongodb', 'localStorage']).toContain(mode);

      const style: 'default' | 'white' = getConfig('logoStyle');
      expect(['default', 'white']).toContain(style);
    });
  });

  describe('getClientConfigScript serialization roundtrip', () => {
    it('should roundtrip all default config values', () => {
      clearEnv(
        'A2A_BASE_URL', 'RAG_URL', 'SSO_ENABLED', 'RAG_ENABLED',
        'MONGODB_ENABLED', 'PREVIEW_MODE',
        'ALLOW_DEV_ADMIN_WHEN_SSO_DISABLED', 'SHOW_POWERED_BY',
        'LOGO_STYLE', 'SPINNER_COLOR', 'TAGLINE', 'DESCRIPTION',
        'APP_NAME', 'LOGO_URL', 'GRADIENT_FROM', 'GRADIENT_TO',
        'SUPPORT_EMAIL',
      );
      delete process.env.MONGODB_URI;
      delete process.env.MONGODB_DATABASE;
      delete process.env.RAG_SERVER_URL;

      const script = getClientConfigScript();
      const parsed: Config = JSON.parse(script);
      const direct = getServerConfig();

      // Every key should match
      for (const key of Object.keys(direct) as (keyof Config)[]) {
        expect(parsed[key]).toEqual(direct[key]);
      }
    });

    it('should roundtrip custom config values', () => {
      process.env.APP_NAME = 'TestRoundtrip';
      process.env.SSO_ENABLED = 'true';
      process.env.LOGO_STYLE = 'white';
      process.env.SPINNER_COLOR = '#abc123';

      const script = getClientConfigScript();
      const parsed: Config = JSON.parse(script);

      expect(parsed.appName).toBe('TestRoundtrip');
      expect(parsed.ssoEnabled).toBe(true);
      expect(parsed.logoStyle).toBe('white');
      expect(parsed.spinnerColor).toBe('#abc123');
    });

    it('should preserve null values through serialization', () => {
      clearEnv('SPINNER_COLOR');
      const script = getClientConfigScript();
      const parsed: Config = JSON.parse(script);
      expect(parsed.spinnerColor).toBeNull();
    });
  });
});

// ==========================================================================
// Integration-style: simulating the full layout → client flow
// ==========================================================================

describe('end-to-end: layout injection → client read', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    setWindowConfig(undefined);
  });

  afterEach(() => {
    process.env = originalEnv;
    setWindowConfig(undefined);
  });

  it('should allow client to read config injected by layout', () => {
    // Step 1: Server (layout.tsx) calls getClientConfigScript()
    process.env.SSO_ENABLED = 'true';
    process.env.APP_NAME = 'IntegrationTestApp';
    process.env.MONGODB_URI = 'mongodb://secret-host:27017';
    process.env.MONGODB_DATABASE = 'test-db';

    const script = getClientConfigScript();

    // Step 2: Browser executes the <script> tag
    // This simulates: window.__APP_CONFIG__ = <script output>
    const injected: Config = JSON.parse(script);
    setWindowConfig(injected);

    // Step 3: Client components call getConfig()
    expect(getConfig('ssoEnabled')).toBe(true);
    expect(getConfig('appName')).toBe('IntegrationTestApp');
    expect(getConfig('mongodbEnabled')).toBe(true);
    expect(getConfig('storageMode')).toBe('mongodb');

    // Step 4: Verify secrets are NOT exposed
    const raw = script;
    expect(raw).not.toContain('secret-host');
    expect(raw).not.toContain('mongodb://');
    expect(raw).not.toContain('test-db');
  });

  it('should handle the "clean deploy" scenario (no env vars)', () => {
    // Simulate a fresh deployment with no env vars at all
    clearEnv(
      'A2A_BASE_URL', 'RAG_URL', 'SSO_ENABLED', 'RAG_ENABLED',
      'MONGODB_ENABLED', 'PREVIEW_MODE',
      'ALLOW_DEV_ADMIN_WHEN_SSO_DISABLED', 'SHOW_POWERED_BY',
      'LOGO_STYLE', 'SPINNER_COLOR', 'TAGLINE', 'DESCRIPTION',
      'APP_NAME', 'LOGO_URL', 'GRADIENT_FROM', 'GRADIENT_TO',
      'SUPPORT_EMAIL',
    );
    delete process.env.MONGODB_URI;
    delete process.env.MONGODB_DATABASE;
    delete process.env.RAG_SERVER_URL;

    const script = getClientConfigScript();
    setWindowConfig(JSON.parse(script));

    // Should get sensible defaults
    expect(getConfig('appName')).toBe('CAIPE');
    expect(getConfig('ssoEnabled')).toBe(false);
    expect(getConfig('ragEnabled')).toBe(true);
    expect(getConfig('storageMode')).toBe('localStorage');
    expect(getConfig('showPoweredBy')).toBe(true);
    expect(getConfig('logoStyle')).toBe('default');
  });

  it('should handle the "full production" scenario', () => {
    process.env.NODE_ENV = 'production';
    process.env.SSO_ENABLED = 'true';
    process.env.APP_NAME = 'Grid';
    process.env.TAGLINE = 'Enterprise AI Platform';
    process.env.LOGO_URL = '/grid-logo.svg';
    process.env.LOGO_STYLE = 'white';
    process.env.GRADIENT_FROM = '#1a1a2e';
    process.env.GRADIENT_TO = '#16213e';
    process.env.SHOW_POWERED_BY = 'false';
    process.env.MONGODB_URI = 'mongodb+srv://admin:secret@cluster.mongodb.net';
    process.env.MONGODB_DATABASE = 'grid-prod';
    process.env.SPINNER_COLOR = '#4ecdc4';
    process.env.SUPPORT_EMAIL = 'support@grid.cisco.com';

    const script = getClientConfigScript();
    setWindowConfig(JSON.parse(script));

    expect(getConfig('appName')).toBe('Grid');
    expect(getConfig('isProd')).toBe(true);
    expect(getConfig('ssoEnabled')).toBe(true);
    expect(getConfig('logoStyle')).toBe('white');
    expect(getConfig('showPoweredBy')).toBe(false);
    expect(getConfig('mongodbEnabled')).toBe(true);
    expect(getConfig('storageMode')).toBe('mongodb');
    expect(getConfig('spinnerColor')).toBe('#4ecdc4');
    expect(getConfig('supportEmail')).toBe('support@grid.cisco.com');
    expect(getConfig('caipeUrl')).toBe('http://caipe-supervisor:8000');

    // Secrets must NOT be in the script
    expect(script).not.toContain('admin:secret');
    expect(script).not.toContain('cluster.mongodb.net');
    expect(script).not.toContain('grid-prod');
  });
});
