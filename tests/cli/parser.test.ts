import { describe, it, expect } from 'vitest';
import { ArgumentParser } from '@/cli/parser';

describe('ArgumentParser', () => {
  let parser: ArgumentParser;

  beforeEach(() => {
    parser = new ArgumentParser();
  });

  describe('define()', () => {
    it('should define a flag argument', () => {
      parser.define({ name: 'verbose', type: 'flag' });
      expect(parser.getDefinedNames()).toContain('verbose');
    });

    it('should define a string argument', () => {
      parser.define({ name: 'name', type: 'string' });
      expect(parser.getDefinedNames()).toContain('name');
    });

    it('should define an array argument', () => {
      parser.define({ name: 'items', type: 'array' });
      expect(parser.getDefinedNames()).toContain('items');
    });

    it('should define an object argument', () => {
      parser.define({ name: 'config', type: 'object' });
      expect(parser.getDefinedNames()).toContain('config');
    });
  });

  describe('parse()', () => {
    beforeEach(() => {
      parser.define({ name: 'verbose', type: 'flag', short: 'v' });
      parser.define({ name: 'name', type: 'string' });
      parser.define({ name: 'items', type: 'array' });
      parser.define({ name: 'config', type: 'object' });
    });

    it('should parse flag arguments', () => {
      const result = parser.parse(['--verbose']);
      expect(result.verbose).toBe(true);
    });

    it('should parse short flag arguments', () => {
      const result = parser.parse(['-v']);
      expect(result.verbose).toBe(true);
    });

    it('should parse string arguments', () => {
      const result = parser.parse(['--name', 'test']);
      expect(result.name).toBe('test');
    });

    it('should parse array arguments', () => {
      const result = parser.parse(['--items', 'a', '--items', 'b']);
      expect(result.items).toEqual(['a', 'b']);
    });

    it('should parse object arguments', () => {
      const result = parser.parse(['--config', 'key=value']);
      expect(result.config).toEqual({ key: 'value' });
    });

    it('should parse positional arguments', () => {
      const result = parser.parse(['pos1', 'pos2', '--verbose']);
      expect(result.positional).toEqual(['pos1', 'pos2']);
    });

    it('should use default values for missing arguments', () => {
      parser.define({ name: 'optional', type: 'string', default: 'default' });
      const result = parser.parse([]);
      expect(result.optional).toBe('default');
    });

    it('should throw error for missing required argument', () => {
      parser.define({ name: 'required', type: 'string', required: true });
      expect(() => parser.parse([])).toThrow('Required argument missing: --required');
    });

    it('should throw error for missing string value', () => {
      expect(() => parser.parse(['--name'])).toThrow('Missing value for argument: --name');
    });

    it('should throw error for malformed key-value', () => {
      expect(() => parser.parse(['--config', 'invalid'])).toThrow('expects KEY=VALUE');
    });

    it('should ignore unknown flags', () => {
      const result = parser.parse(['--unknown', '--verbose']);
      expect(result.verbose).toBe(true);
      expect(result.unknown).toBeUndefined();
    });
  });
});
