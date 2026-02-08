/**
 * Tests for the layout → client config injection pipeline.
 *
 * Validates that:
 * - getClientConfigScript() produces valid, XSS-safe JSON
 * - The JSON can be parsed and set on window.__APP_CONFIG__
 * - getConfig() and config proxy read the injected values correctly
 * - generateMetadata() uses runtime env vars (not hardcoded defaults)
 * - Server-only secrets are never included
 */

import {
  getServerConfig,
  getClientConfigScript,
  getConfig,
  config,
} from '../config';
import type { Config } from '../config';

/** Typed accessor for window.__APP_CONFIG__ */
const setWindowConfig = (cfg: Config | undefined) => {
  (window as unknown as { __APP_CONFIG__?: Config }).__APP_CONFIG__ = cfg;
};

describe('layout config injection pipeline', () => {
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

  describe('script tag simulation', () => {
    it('should produce a script that sets window.__APP_CONFIG__', () => {
      process.env.SSO_ENABLED = 'true';
      process.env.APP_NAME = 'TestApp';
      process.env.MONGODB_URI = 'mongodb://localhost:27017';
      process.env.MONGODB_DATABASE = 'testdb';

      const script = getClientConfigScript();

      // Simulate what the browser does with <script>window.__APP_CONFIG__=...;</script>
      // eslint-disable-next-line no-eval
      const fn = new Function(`window.__APP_CONFIG__=${script};`);
      fn();

      const injected = (window as any).__APP_CONFIG__;
      expect(injected).toBeDefined();
      expect(injected.appName).toBe('TestApp');
      expect(injected.ssoEnabled).toBe(true);
      expect(injected.mongodbEnabled).toBe(true);
      expect(injected.storageMode).toBe('mongodb');
    });

    it('should survive XSS attempts in script execution', () => {
      process.env.APP_NAME = '</script><script>alert(1)</script>';
      const script = getClientConfigScript();

      // The script should NOT contain raw </script>
      expect(script).not.toContain('</script>');
      expect(script).not.toContain('<script>');

      // It should still be parseable
      const fn = new Function(`window.__APP_CONFIG__=${script};`);
      fn();

      const injected = (window as any).__APP_CONFIG__;
      expect(injected.appName).toBe('</script><script>alert(1)</script>');
    });
  });

  describe('full pipeline: env → getServerConfig → script → client', () => {
    it('should pipeline SSO enabled from env to client getConfig()', () => {
      process.env.SSO_ENABLED = 'true';

      // 1. Server generates script
      const script = getClientConfigScript();

      // 2. Browser executes script
      setWindowConfig(JSON.parse(script));

      // 3. Client reads config
      expect(getConfig('ssoEnabled')).toBe(true);
    });

    it('should pipeline branding from env to client config proxy', () => {
      process.env.APP_NAME = 'BrandedApp';
      process.env.TAGLINE = 'Build Amazing Things';
      process.env.LOGO_STYLE = 'white';
      process.env.SHOW_POWERED_BY = 'false';

      const script = getClientConfigScript();
      setWindowConfig(JSON.parse(script));

      expect(config.appName).toBe('BrandedApp');
      expect(config.tagline).toBe('Build Amazing Things');
      expect(config.logoStyle).toBe('white');
      expect(config.showPoweredBy).toBe(false);
    });

    it('should pipeline storage mode from env to client', () => {
      process.env.MONGODB_URI = 'mongodb://host:27017';
      process.env.MONGODB_DATABASE = 'prod';

      const script = getClientConfigScript();
      setWindowConfig(JSON.parse(script));

      expect(getConfig('storageMode')).toBe('mongodb');
      expect(getConfig('mongodbEnabled')).toBe(true);
    });

    it('should not expose MONGODB_URI in client script', () => {
      process.env.MONGODB_URI = 'mongodb://admin:secret@prod-host:27017';
      process.env.MONGODB_DATABASE = 'caipe';

      const script = getClientConfigScript();

      expect(script).not.toContain('admin:secret');
      expect(script).not.toContain('prod-host');
      expect(script).not.toContain('mongodb://');

      // But mongodbEnabled should be true
      const parsed = JSON.parse(script);
      expect(parsed.mongodbEnabled).toBe(true);
    });

    it('should not expose OIDC secrets in client script', () => {
      process.env.OIDC_CLIENT_SECRET = 'super-secret-value';
      process.env.OIDC_CLIENT_ID = 'client-id';
      process.env.NEXTAUTH_SECRET = 'nextauth-secret';

      const script = getClientConfigScript();

      expect(script).not.toContain('super-secret-value');
      expect(script).not.toContain('nextauth-secret');
      // Client ID is also server-only
      expect(script).not.toContain('client-id');
    });

    it('should not expose Langfuse secrets in client script', () => {
      process.env.LANGFUSE_SECRET_KEY = 'sk-lf-secret';
      process.env.LANGFUSE_PUBLIC_KEY = 'pk-lf-public';

      const script = getClientConfigScript();

      expect(script).not.toContain('sk-lf-secret');
      expect(script).not.toContain('pk-lf-public');
    });
  });

  describe('generateMetadata equivalent (server-side branding)', () => {
    it('should use APP_NAME for metadata title', () => {
      process.env.APP_NAME = 'GridUI';
      const cfg = getServerConfig();
      expect(`${cfg.appName} UI`).toBe('GridUI UI');
    });

    it('should use TAGLINE and DESCRIPTION for metadata description', () => {
      process.env.TAGLINE = 'Custom Tag';
      process.env.DESCRIPTION = 'Custom Desc';
      const cfg = getServerConfig();
      const fullDescription = `${cfg.tagline} - ${cfg.description}`;
      expect(fullDescription).toBe('Custom Tag - Custom Desc');
    });

    it('should use defaults when env vars are not set', () => {
      delete process.env.APP_NAME;
      delete process.env.NEXT_PUBLIC_APP_NAME;
      delete process.env.TAGLINE;
      delete process.env.NEXT_PUBLIC_TAGLINE;

      const cfg = getServerConfig();
      expect(cfg.appName).toBe('CAIPE');
      expect(cfg.tagline).toBe('Multi-Agent Workflow Automation');
    });
  });

  describe('config consistency: server === client', () => {
    it('should produce identical config on server and client', () => {
      process.env.SSO_ENABLED = 'true';
      process.env.APP_NAME = 'ConsistencyTest';
      process.env.LOGO_STYLE = 'white';
      process.env.MONGODB_URI = 'mongodb://localhost:27017';
      process.env.MONGODB_DATABASE = 'test';
      process.env.SPINNER_COLOR = '#abc';

      const serverCfg = getServerConfig();
      const script = getClientConfigScript();
      setWindowConfig(JSON.parse(script));

      // Every key should match between server and client
      for (const key of Object.keys(serverCfg) as (keyof Config)[]) {
        expect(getConfig(key)).toEqual(serverCfg[key]);
      }
    });
  });
});
