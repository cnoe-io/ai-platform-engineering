/**
 * Enhanced tests for config system including mongodbEnabled and branding
 */

import { config, getConfig, logConfig } from '../config';

describe('config - Extended', () => {
  const originalEnv = process.env;
  const originalWindow = global.window;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    
    // Reset window.__ENV__
    if (typeof window !== 'undefined') {
      (window as any).__ENV__ = undefined;
    }
  });

  afterEach(() => {
    process.env = originalEnv;
    global.window = originalWindow;
  });

  describe('mongodbEnabled configuration', () => {
    it('should return false when NEXT_PUBLIC_MONGODB_ENABLED is not set', () => {
      const result = getConfig('mongodbEnabled');
      expect(result).toBe(false);
    });

    it('should return true when NEXT_PUBLIC_MONGODB_ENABLED is "true"', () => {
      process.env.NEXT_PUBLIC_MONGODB_ENABLED = 'true';
      const { config: newConfig } = require('../config');
      expect(newConfig.mongodbEnabled).toBe(true);
    });

    it('should return false when NEXT_PUBLIC_MONGODB_ENABLED is "false"', () => {
      process.env.NEXT_PUBLIC_MONGODB_ENABLED = 'false';
      const { config: newConfig } = require('../config');
      expect(newConfig.mongodbEnabled).toBe(false);
    });

    it('should return false when NEXT_PUBLIC_MONGODB_ENABLED is any other value', () => {
      process.env.NEXT_PUBLIC_MONGODB_ENABLED = 'maybe';
      const { config: newConfig } = require('../config');
      expect(newConfig.mongodbEnabled).toBe(false);
    });
  });

  describe('ssoEnabled configuration', () => {
    it('should return false by default', () => {
      expect(config.ssoEnabled).toBe(false);
    });

    it('should return true when NEXT_PUBLIC_SSO_ENABLED is "true"', () => {
      process.env.NEXT_PUBLIC_SSO_ENABLED = 'true';
      const { config: newConfig } = require('../config');
      expect(newConfig.ssoEnabled).toBe(true);
    });
  });

  describe('enableSubAgentCards configuration', () => {
    it('should return false by default', () => {
      expect(config.enableSubAgentCards).toBe(false);
    });

    it('should return true when NEXT_PUBLIC_ENABLE_SUBAGENT_CARDS is "true"', () => {
      process.env.NEXT_PUBLIC_ENABLE_SUBAGENT_CARDS = 'true';
      const { config: newConfig } = require('../config');
      expect(newConfig.enableSubAgentCards).toBe(true);
    });
  });

  describe('branding configuration', () => {
    it('should use default values when no env vars set', () => {
      // Check that config has string values (actual defaults may vary)
      expect(typeof config.tagline).toBe('string');
      expect(typeof config.description).toBe('string');
      expect(typeof config.appName).toBe('string');
      expect(typeof config.logoUrl).toBe('string');
      expect(typeof config.previewMode).toBe('boolean');
    });

    it('should use custom tagline when NEXT_PUBLIC_TAGLINE is set', () => {
      process.env.NEXT_PUBLIC_TAGLINE = 'Custom Tagline';
      const { config: newConfig } = require('../config');
      expect(newConfig.tagline).toBe('Custom Tagline');
    });

    it('should use custom description when NEXT_PUBLIC_DESCRIPTION is set', () => {
      process.env.NEXT_PUBLIC_DESCRIPTION = 'Custom Description';
      const { config: newConfig } = require('../config');
      expect(newConfig.description).toBe('Custom Description');
    });

    it('should use custom app name when NEXT_PUBLIC_APP_NAME is set', () => {
      process.env.NEXT_PUBLIC_APP_NAME = 'MyApp';
      const { config: newConfig } = require('../config');
      expect(newConfig.appName).toBe('MyApp');
    });

    it('should use custom logo URL when NEXT_PUBLIC_LOGO_URL is set', () => {
      process.env.NEXT_PUBLIC_LOGO_URL = '/custom-logo.png';
      const { config: newConfig } = require('../config');
      expect(newConfig.logoUrl).toBe('/custom-logo.png');
    });

    it('should disable preview mode when NEXT_PUBLIC_PREVIEW_MODE is "false"', () => {
      process.env.NEXT_PUBLIC_PREVIEW_MODE = 'false';
      const { config: newConfig } = require('../config');
      expect(newConfig.previewMode).toBe(false);
    });
  });

  describe('gradient configuration', () => {
    it('should use default gradient colors', () => {
      // Check that gradients are strings
      expect(typeof config.gradientFrom).toBe('string');
      expect(typeof config.gradientTo).toBe('string');
      expect(config.gradientFrom.length).toBeGreaterThan(0);
      expect(config.gradientTo.length).toBeGreaterThan(0);
    });

    it('should use custom gradient colors when env vars set', () => {
      process.env.NEXT_PUBLIC_GRADIENT_FROM = 'from-red-500';
      process.env.NEXT_PUBLIC_GRADIENT_TO = 'to-blue-500';
      const { config: newConfig } = require('../config');
      expect(newConfig.gradientFrom).toBe('from-red-500');
      expect(newConfig.gradientTo).toBe('to-blue-500');
    });
  });

  describe('logo style configuration', () => {
    it('should use "default" logo style by default', () => {
      expect(config.logoStyle).toBe('default');
    });

    it('should use "white" logo style when specified', () => {
      process.env.NEXT_PUBLIC_LOGO_STYLE = 'white';
      const { config: newConfig } = require('../config');
      expect(newConfig.logoStyle).toBe('white');
    });

    it('should fall back to "default" for invalid logo style', () => {
      process.env.NEXT_PUBLIC_LOGO_STYLE = 'invalid';
      const { config: newConfig } = require('../config');
      expect(newConfig.logoStyle).toBe('default');
    });
  });

  describe('spinner color configuration', () => {
    it('should return null by default', () => {
      expect(config.spinnerColor).toBeNull();
    });

    it('should use custom spinner color when set', () => {
      process.env.NEXT_PUBLIC_SPINNER_COLOR = '#FF5733';
      const { config: newConfig } = require('../config');
      expect(newConfig.spinnerColor).toBe('#FF5733');
    });
  });

  describe('showPoweredBy configuration', () => {
    it('should return true by default', () => {
      expect(config.showPoweredBy).toBe(true);
    });

    it('should return false when NEXT_PUBLIC_SHOW_POWERED_BY is "false"', () => {
      process.env.NEXT_PUBLIC_SHOW_POWERED_BY = 'false';
      const { config: newConfig } = require('../config');
      expect(newConfig.showPoweredBy).toBe(false);
    });
  });

  describe('getConfig', () => {
    it('should return correct value for mongodbEnabled', () => {
      expect(getConfig('mongodbEnabled')).toBe(false);
    });

    it('should return correct value for ssoEnabled', () => {
      expect(getConfig('ssoEnabled')).toBe(false);
    });

    it('should return correct value for enableSubAgentCards', () => {
      expect(getConfig('enableSubAgentCards')).toBe(false);
    });

    it('should return correct value for tagline', () => {
      const tagline = getConfig('tagline');
      expect(typeof tagline).toBe('string');
      expect(tagline.length).toBeGreaterThan(0);
    });

    it('should return correct value for appName', () => {
      expect(getConfig('appName')).toBe('CAIPE');
    });
  });

  describe('logConfig', () => {
    it('should call logConfig without throwing errors', () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
      
      expect(() => logConfig()).not.toThrow();
      
      // logConfig may or may not log in test environment
      consoleLogSpy.mockRestore();
    });
  });

  describe('environment detection', () => {
    it('should detect development environment', () => {
      process.env.NODE_ENV = 'development';
      const { config: newConfig } = require('../config');
      expect(newConfig.isDev).toBe(true);
      expect(newConfig.isProd).toBe(false);
    });

    it('should detect production environment', () => {
      process.env.NODE_ENV = 'production';
      const { config: newConfig } = require('../config');
      expect(newConfig.isDev).toBe(false);
      expect(newConfig.isProd).toBe(true);
    });
  });

  describe('CAIPE URL configuration', () => {
    it('should use default CAIPE URL', () => {
      expect(config.caipeUrl).toBe('http://localhost:8000');
    });

    it('should use NEXT_PUBLIC_CAIPE_URL when set', () => {
      process.env.NEXT_PUBLIC_CAIPE_URL = 'https://api.example.com';
      const { config: newConfig } = require('../config');
      expect(newConfig.caipeUrl).toBe('https://api.example.com');
    });
  });

  describe('RAG URL configuration', () => {
    it('should have a valid RAG URL', () => {
      expect(typeof config.ragUrl).toBe('string');
      expect(config.ragUrl.length).toBeGreaterThan(0);
      // RAG URL should be a valid URL or path
      expect(config.ragUrl).toMatch(/^https?:\/\//);
    });
  });
});
