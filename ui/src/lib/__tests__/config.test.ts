/**
 * Tests for the server-side config system (getServerConfig)
 *
 * Config is now served to the client via GET /api/config.
 * No window.__RUNTIME_ENV__ — client uses ConfigProvider + useConfig().
 */

import { getServerConfig, getConfig, getLogoFilterClass } from '../config';
import type { Config } from '../config';

describe('config - Server Side', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getServerConfig defaults', () => {
    it('should return false for mongodbEnabled when env vars not set', () => {
      delete process.env.MONGODB_URI;
      delete process.env.MONGODB_DATABASE;
      delete process.env.MONGODB_ENABLED;
      const cfg = getServerConfig();
      expect(cfg.mongodbEnabled).toBe(false);
    });

    it('should return false for ssoEnabled by default', () => {
      delete process.env.SSO_ENABLED;
      delete process.env.NEXT_PUBLIC_SSO_ENABLED;
      const cfg = getServerConfig();
      expect(cfg.ssoEnabled).toBe(false);
    });

    it('should return false for enableSubAgentCards by default', () => {
      delete process.env.ENABLE_SUBAGENT_CARDS;
      delete process.env.NEXT_PUBLIC_ENABLE_SUBAGENT_CARDS;
      const cfg = getServerConfig();
      expect(cfg.enableSubAgentCards).toBe(false);
    });

    it('should return default tagline', () => {
      delete process.env.TAGLINE;
      delete process.env.NEXT_PUBLIC_TAGLINE;
      const cfg = getServerConfig();
      expect(cfg.tagline).toBe('Multi-Agent Workflow Automation');
    });

    it('should return default appName', () => {
      delete process.env.APP_NAME;
      delete process.env.NEXT_PUBLIC_APP_NAME;
      const cfg = getServerConfig();
      expect(cfg.appName).toBe('CAIPE');
    });
  });

  describe('getServerConfig with env vars (new names)', () => {
    it('should read SSO_ENABLED=true', () => {
      process.env.SSO_ENABLED = 'true';
      const cfg = getServerConfig();
      expect(cfg.ssoEnabled).toBe(true);
    });

    it('should read A2A_BASE_URL', () => {
      process.env.A2A_BASE_URL = 'https://my-supervisor:8000';
      const cfg = getServerConfig();
      expect(cfg.caipeUrl).toBe('https://my-supervisor:8000');
    });

    it('should read APP_NAME', () => {
      process.env.APP_NAME = 'Grid';
      const cfg = getServerConfig();
      expect(cfg.appName).toBe('Grid');
    });

    it('should read LOGO_URL', () => {
      process.env.LOGO_URL = '/grid-neon-logo.svg';
      const cfg = getServerConfig();
      expect(cfg.logoUrl).toBe('/grid-neon-logo.svg');
    });

    it('should detect mongodbEnabled from MONGODB_URI + MONGODB_DATABASE', () => {
      process.env.MONGODB_URI = 'mongodb://localhost:27017';
      process.env.MONGODB_DATABASE = 'caipe';
      const cfg = getServerConfig();
      expect(cfg.mongodbEnabled).toBe(true);
      expect(cfg.storageMode).toBe('mongodb');
    });

    it('should read ENABLE_SUBAGENT_CARDS', () => {
      process.env.ENABLE_SUBAGENT_CARDS = 'true';
      const cfg = getServerConfig();
      expect(cfg.enableSubAgentCards).toBe(true);
    });

    it('should read TAGLINE', () => {
      process.env.TAGLINE = 'Custom Tagline';
      const cfg = getServerConfig();
      expect(cfg.tagline).toBe('Custom Tagline');
    });
  });

  describe('backward compatibility (NEXT_PUBLIC_ prefix)', () => {
    it('should read NEXT_PUBLIC_SSO_ENABLED as fallback', () => {
      delete process.env.SSO_ENABLED;
      process.env.NEXT_PUBLIC_SSO_ENABLED = 'true';
      const cfg = getServerConfig();
      expect(cfg.ssoEnabled).toBe(true);
    });

    it('should read NEXT_PUBLIC_APP_NAME as fallback', () => {
      delete process.env.APP_NAME;
      process.env.NEXT_PUBLIC_APP_NAME = 'LegacyApp';
      const cfg = getServerConfig();
      expect(cfg.appName).toBe('LegacyApp');
    });

    it('should prefer non-prefixed over NEXT_PUBLIC_', () => {
      process.env.APP_NAME = 'NewName';
      process.env.NEXT_PUBLIC_APP_NAME = 'OldName';
      const cfg = getServerConfig();
      expect(cfg.appName).toBe('NewName');
    });
  });

  describe('branding configuration', () => {
    it('should use default gradient colors', () => {
      const cfg = getServerConfig();
      expect(typeof cfg.gradientFrom).toBe('string');
      expect(typeof cfg.gradientTo).toBe('string');
      expect(cfg.gradientFrom.length).toBeGreaterThan(0);
    });

    it('should use custom gradient colors', () => {
      process.env.GRADIENT_FROM = '#ff0000';
      process.env.GRADIENT_TO = '#0000ff';
      const cfg = getServerConfig();
      expect(cfg.gradientFrom).toBe('#ff0000');
      expect(cfg.gradientTo).toBe('#0000ff');
    });
  });

  describe('logo style', () => {
    it('should default to "default"', () => {
      const cfg = getServerConfig();
      expect(cfg.logoStyle).toBe('default');
    });

    it('should accept "white"', () => {
      process.env.LOGO_STYLE = 'white';
      const cfg = getServerConfig();
      expect(cfg.logoStyle).toBe('white');
    });

    it('should fall back to "default" for invalid values', () => {
      process.env.LOGO_STYLE = 'invalid';
      const cfg = getServerConfig();
      expect(cfg.logoStyle).toBe('default');
    });
  });

  describe('showPoweredBy', () => {
    it('should default to true', () => {
      const cfg = getServerConfig();
      expect(cfg.showPoweredBy).toBe(true);
    });

    it('should return false when SHOW_POWERED_BY=false', () => {
      process.env.SHOW_POWERED_BY = 'false';
      const cfg = getServerConfig();
      expect(cfg.showPoweredBy).toBe(false);
    });
  });

  describe('getLogoFilterClass', () => {
    it('should return empty string for default style', () => {
      expect(getLogoFilterClass('default')).toBe('');
    });

    it('should return brightness-0 invert for white style', () => {
      expect(getLogoFilterClass('white')).toBe('brightness-0 invert');
    });
  });

  describe('getConfig (deprecated shim)', () => {
    it('should still work for backward compatibility', () => {
      expect(getConfig('appName')).toBe('CAIPE');
      expect(typeof getConfig('tagline')).toBe('string');
    });
  });

  describe('CAIPE URL configuration', () => {
    it('should use default CAIPE URL in dev', () => {
      const cfg = getServerConfig();
      expect(cfg.caipeUrl).toBe('http://localhost:8000');
    });

    it('should use A2A_BASE_URL when set', () => {
      process.env.A2A_BASE_URL = 'https://api.example.com';
      const cfg = getServerConfig();
      expect(cfg.caipeUrl).toBe('https://api.example.com');
    });
  });

  describe('RAG URL configuration', () => {
    it('should have a valid RAG URL', () => {
      const cfg = getServerConfig();
      expect(typeof cfg.ragUrl).toBe('string');
      expect(cfg.ragUrl).toMatch(/^https?:\/\//);
    });
  });

  describe('storageMode', () => {
    it('should return localStorage when MongoDB not configured', () => {
      delete process.env.MONGODB_URI;
      delete process.env.MONGODB_DATABASE;
      const cfg = getServerConfig();
      expect(cfg.storageMode).toBe('localStorage');
    });

    it('should return mongodb when both URI and DATABASE set', () => {
      process.env.MONGODB_URI = 'mongodb://localhost:27017';
      process.env.MONGODB_DATABASE = 'test';
      const cfg = getServerConfig();
      expect(cfg.storageMode).toBe('mongodb');
    });
  });
});
