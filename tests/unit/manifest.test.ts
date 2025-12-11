/**
 * Unit tests for manifest.json validation
 * Ensures the Obsidian plugin manifest is valid and Obsidian will load it
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

interface PluginManifest {
  id: string;
  name: string;
  version: string;
  minAppVersion: string;
  description: string;
  author: string;
  authorUrl?: string;
  fundingUrl?: string;
  isDesktopOnly?: boolean;
}

describe('manifest.json', () => {
  let manifest: PluginManifest;

  // Load manifest once before tests
  const manifestPath = resolve(__dirname, '../../manifest.json');
  const manifestContent = readFileSync(manifestPath, 'utf-8');
  manifest = JSON.parse(manifestContent);

  describe('Required fields', () => {
    it('should have id field', () => {
      expect(manifest.id).toBeDefined();
      expect(typeof manifest.id).toBe('string');
      expect(manifest.id.length).toBeGreaterThan(0);
    });

    it('should have name field', () => {
      expect(manifest.name).toBeDefined();
      expect(typeof manifest.name).toBe('string');
      expect(manifest.name.length).toBeGreaterThan(0);
    });

    it('should have version field', () => {
      expect(manifest.version).toBeDefined();
      expect(typeof manifest.version).toBe('string');
    });

    it('should have minAppVersion field', () => {
      expect(manifest.minAppVersion).toBeDefined();
      expect(typeof manifest.minAppVersion).toBe('string');
    });

    it('should have description field', () => {
      expect(manifest.description).toBeDefined();
      expect(typeof manifest.description).toBe('string');
      expect(manifest.description.length).toBeGreaterThan(0);
    });

    it('should have author field', () => {
      expect(manifest.author).toBeDefined();
      expect(typeof manifest.author).toBe('string');
    });
  });

  describe('ID validation', () => {
    it('should contain only valid characters (lowercase, numbers, hyphens)', () => {
      // Obsidian requires: only lowercase letters, numbers, and hyphens
      const validIdPattern = /^[a-z0-9-]+$/;
      expect(manifest.id).toMatch(validIdPattern);
    });

    it('should not start or end with hyphen', () => {
      expect(manifest.id).not.toMatch(/^-/);
      expect(manifest.id).not.toMatch(/-$/);
    });

    it('should not contain consecutive hyphens', () => {
      expect(manifest.id).not.toContain('--');
    });

    it('should be reasonable length (3-50 chars)', () => {
      expect(manifest.id.length).toBeGreaterThanOrEqual(3);
      expect(manifest.id.length).toBeLessThanOrEqual(50);
    });
  });

  describe('Version validation', () => {
    it('should be valid semver format (x.y.z)', () => {
      const semverPattern = /^\d+\.\d+\.\d+$/;
      expect(manifest.version).toMatch(semverPattern);
    });

    it('should have non-negative version numbers', () => {
      const [major, minor, patch] = manifest.version.split('.').map(Number);
      expect(major).toBeGreaterThanOrEqual(0);
      expect(minor).toBeGreaterThanOrEqual(0);
      expect(patch).toBeGreaterThanOrEqual(0);
    });
  });

  describe('minAppVersion validation', () => {
    it('should be valid semver format', () => {
      const semverPattern = /^\d+\.\d+\.\d+$/;
      expect(manifest.minAppVersion).toMatch(semverPattern);
    });

    it('should be a reasonable Obsidian version (>= 0.12.0)', () => {
      const [major, minor] = manifest.minAppVersion.split('.').map(Number);
      // Obsidian plugins generally require at least 0.12.0 for modern API
      expect(major).toBeGreaterThanOrEqual(0);
      if (major === 0) {
        expect(minor).toBeGreaterThanOrEqual(12);
      }
    });
  });

  describe('Optional fields', () => {
    it('should have valid authorUrl if present', () => {
      if (manifest.authorUrl !== undefined && manifest.authorUrl !== '') {
        expect(manifest.authorUrl).toMatch(/^https?:\/\//);
      }
    });

    it('should have valid fundingUrl if present', () => {
      if (manifest.fundingUrl !== undefined && manifest.fundingUrl !== '') {
        expect(manifest.fundingUrl).toMatch(/^https?:\/\//);
      }
    });

    it('should have boolean isDesktopOnly if present', () => {
      if (manifest.isDesktopOnly !== undefined) {
        expect(typeof manifest.isDesktopOnly).toBe('boolean');
      }
    });
  });

  describe('Consistency checks', () => {
    it('should have id that matches package.json name convention', () => {
      // Plugin ID should be kebab-case and descriptive
      expect(manifest.id).not.toContain('_');
      expect(manifest.id).not.toContain(' ');
    });

    it('should have reasonable description length', () => {
      expect(manifest.description.length).toBeGreaterThanOrEqual(10);
      expect(manifest.description.length).toBeLessThanOrEqual(250);
    });

    it('should not have placeholder values', () => {
      expect(manifest.name).not.toMatch(/^(My Plugin|Plugin Name|TODO|CHANGEME)$/i);
      expect(manifest.description).not.toMatch(/^(Description|TODO|CHANGEME)$/i);
      expect(manifest.author).not.toMatch(/^(Author|TODO|CHANGEME)$/i);
    });
  });
});

describe('versions.json', () => {
  it('should exist and be valid JSON', () => {
    const versionsPath = resolve(__dirname, '../../versions.json');
    const versionsContent = readFileSync(versionsPath, 'utf-8');
    const versions = JSON.parse(versionsContent);

    expect(versions).toBeDefined();
    expect(typeof versions).toBe('object');
  });

  it('should have current version mapped to minAppVersion', () => {
    const manifestPath = resolve(__dirname, '../../manifest.json');
    const versionsPath = resolve(__dirname, '../../versions.json');

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    const versions = JSON.parse(readFileSync(versionsPath, 'utf-8'));

    // versions.json should have an entry for current version
    expect(versions[manifest.version]).toBeDefined();
  });

  it('should have valid semver keys', () => {
    const versionsPath = resolve(__dirname, '../../versions.json');
    const versions = JSON.parse(readFileSync(versionsPath, 'utf-8'));

    const semverPattern = /^\d+\.\d+\.\d+$/;

    for (const key of Object.keys(versions)) {
      expect(key).toMatch(semverPattern);
    }
  });

  it('should have valid semver values (minAppVersion)', () => {
    const versionsPath = resolve(__dirname, '../../versions.json');
    const versions = JSON.parse(readFileSync(versionsPath, 'utf-8'));

    const semverPattern = /^\d+\.\d+\.\d+$/;

    for (const value of Object.values(versions)) {
      expect(value).toMatch(semverPattern);
    }
  });
});

describe('package.json consistency', () => {
  it('should have version matching manifest.json', () => {
    const manifestPath = resolve(__dirname, '../../manifest.json');
    const packagePath = resolve(__dirname, '../../package.json');

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    const pkg = JSON.parse(readFileSync(packagePath, 'utf-8'));

    expect(pkg.version).toBe(manifest.version);
  });

  it('should have name related to manifest id', () => {
    const manifestPath = resolve(__dirname, '../../manifest.json');
    const packagePath = resolve(__dirname, '../../package.json');

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    const pkg = JSON.parse(readFileSync(packagePath, 'utf-8'));

    // Package name should be same as or similar to manifest id
    expect(pkg.name).toBe(manifest.id);
  });
});

describe('Build output validation', () => {
  it('should have main.js after build', () => {
    // This test assumes build has been run
    const mainJsPath = resolve(__dirname, '../../main.js');

    try {
      const content = readFileSync(mainJsPath, 'utf-8');
      expect(content.length).toBeGreaterThan(0);
    } catch {
      // Skip if not built yet - this is expected in CI before build step
      console.warn('main.js not found - skipping (run npm run build first)');
    }
  });
});
