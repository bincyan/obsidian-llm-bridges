/**
 * Unit tests for types.ts
 * Tests type definitions and constants
 */

import { describe, it, expect } from 'vitest';
import {
  LLM_BRIDGES_DIR,
  KNOWLEDGE_BASE_DIR,
  FOLDER_CONSTRAINTS_DIR,
  META_FILE,
  DEFAULT_READ_LIMIT,
  VALIDATION_INSTRUCTIONS,
} from '../../src/types';

describe('Constants', () => {
  describe('Directory constants', () => {
    it('should have correct LLM_BRIDGES_DIR', () => {
      expect(LLM_BRIDGES_DIR).toBe('.llm_bridges');
    });

    it('should have correct KNOWLEDGE_BASE_DIR', () => {
      expect(KNOWLEDGE_BASE_DIR).toBe('knowledge_base');
    });

    it('should have correct FOLDER_CONSTRAINTS_DIR', () => {
      expect(FOLDER_CONSTRAINTS_DIR).toBe('folder_constraints');
    });

    it('should have correct META_FILE', () => {
      expect(META_FILE).toBe('meta.md');
    });
  });

  describe('DEFAULT_READ_LIMIT', () => {
    it('should be a reasonable value', () => {
      expect(DEFAULT_READ_LIMIT).toBe(10000);
      expect(DEFAULT_READ_LIMIT).toBeGreaterThan(0);
    });
  });
});

describe('VALIDATION_INSTRUCTIONS', () => {
  it('should have create_note instruction', () => {
    expect(VALIDATION_INSTRUCTIONS.create_note).toBeDefined();
    expect(VALIDATION_INSTRUCTIONS.create_note).toContain('organization_rules');
  });

  it('should have update_note instruction', () => {
    expect(VALIDATION_INSTRUCTIONS.update_note).toBeDefined();
    expect(VALIDATION_INSTRUCTIONS.update_note).toContain('original');
    expect(VALIDATION_INSTRUCTIONS.update_note).toContain('updated');
  });

  it('should have append_note instruction', () => {
    expect(VALIDATION_INSTRUCTIONS.append_note).toBeDefined();
    expect(VALIDATION_INSTRUCTIONS.append_note).toContain('append');
  });

  it('should have move_note instruction', () => {
    expect(VALIDATION_INSTRUCTIONS.move_note).toBeDefined();
    expect(VALIDATION_INSTRUCTIONS.move_note).toContain('moved');
  });

  it('should mention update_note as follow-up action', () => {
    // All instructions should tell LLM to use update_note if issues found
    Object.values(VALIDATION_INSTRUCTIONS).forEach((instruction) => {
      expect(instruction).toContain('update_note');
    });
  });
});

describe('Type Guards (runtime validation)', () => {
  // These functions help validate data at runtime matches expected types

  function isValidErrorCode(code: string): boolean {
    const validCodes = [
      'knowledge_base_not_found',
      'knowledge_base_already_exists',
      'folder_constraint_violation',
      'note_not_found',
      'note_already_exists',
      'invalid_note_path',
      'schema_validation_failed',
      'subfolder_overlap',
      'version_conflict',
    ];
    return validCodes.includes(code);
  }

  function isValidValidationErrorType(type: string): boolean {
    const validTypes = [
      'missing_required_field',
      'invalid_field_type',
      'invalid_value',
      'pattern_mismatch',
      'content_too_short',
      'content_too_long',
      'missing_section',
    ];
    return validTypes.includes(type);
  }

  function isValidFieldType(type: string): boolean {
    const validTypes = ['string', 'number', 'boolean', 'date', 'array'];
    return validTypes.includes(type);
  }

  describe('isValidErrorCode', () => {
    it('should accept valid error codes', () => {
      expect(isValidErrorCode('knowledge_base_not_found')).toBe(true);
      expect(isValidErrorCode('folder_constraint_violation')).toBe(true);
      expect(isValidErrorCode('note_not_found')).toBe(true);
    });

    it('should reject invalid error codes', () => {
      expect(isValidErrorCode('invalid_code')).toBe(false);
      expect(isValidErrorCode('')).toBe(false);
      expect(isValidErrorCode('KNOWLEDGE_BASE_NOT_FOUND')).toBe(false); // case sensitive
    });
  });

  describe('isValidValidationErrorType', () => {
    it('should accept valid validation error types', () => {
      expect(isValidValidationErrorType('missing_required_field')).toBe(true);
      expect(isValidValidationErrorType('invalid_field_type')).toBe(true);
      expect(isValidValidationErrorType('pattern_mismatch')).toBe(true);
    });

    it('should reject invalid validation error types', () => {
      expect(isValidValidationErrorType('unknown_error')).toBe(false);
      expect(isValidValidationErrorType('')).toBe(false);
    });
  });

  describe('isValidFieldType', () => {
    it('should accept valid field types', () => {
      expect(isValidFieldType('string')).toBe(true);
      expect(isValidFieldType('number')).toBe(true);
      expect(isValidFieldType('boolean')).toBe(true);
      expect(isValidFieldType('date')).toBe(true);
      expect(isValidFieldType('array')).toBe(true);
    });

    it('should reject invalid field types', () => {
      expect(isValidFieldType('object')).toBe(false);
      expect(isValidFieldType('int')).toBe(false);
      expect(isValidFieldType('')).toBe(false);
    });
  });
});

describe('Response Structure Validation', () => {
  // Validate that response objects match expected structure

  interface ValidationResult {
    passed: boolean;
    issues: Array<{
      field: string;
      error: string;
      expected?: unknown;
      actual?: unknown;
      pattern?: string;
      message?: string;
    }>;
  }

  function isValidValidationResult(obj: unknown): obj is ValidationResult {
    if (typeof obj !== 'object' || obj === null) return false;

    const result = obj as Record<string, unknown>;

    if (typeof result.passed !== 'boolean') return false;
    if (!Array.isArray(result.issues)) return false;

    for (const issue of result.issues) {
      if (typeof issue !== 'object' || issue === null) return false;
      if (typeof (issue as Record<string, unknown>).field !== 'string') return false;
      if (typeof (issue as Record<string, unknown>).error !== 'string') return false;
    }

    return true;
  }

  it('should validate correct ValidationResult', () => {
    const validResult = {
      passed: true,
      issues: [],
    };

    expect(isValidValidationResult(validResult)).toBe(true);
  });

  it('should validate ValidationResult with issues', () => {
    const resultWithIssues = {
      passed: false,
      issues: [
        {
          field: 'frontmatter.title',
          error: 'missing_required_field',
          message: 'Title is required',
        },
      ],
    };

    expect(isValidValidationResult(resultWithIssues)).toBe(true);
  });

  it('should reject invalid ValidationResult', () => {
    expect(isValidValidationResult(null)).toBe(false);
    expect(isValidValidationResult({})).toBe(false);
    expect(isValidValidationResult({ passed: 'yes', issues: [] })).toBe(false);
    expect(isValidValidationResult({ passed: true, issues: 'none' })).toBe(false);
  });
});

describe('KnowledgeBase Structure', () => {
  interface KnowledgeBase {
    name: string;
    create_time: string;
    description: string;
    subfolder: string;
    organization_rules: string;
  }

  function isValidKnowledgeBase(obj: unknown): obj is KnowledgeBase {
    if (typeof obj !== 'object' || obj === null) return false;

    const kb = obj as Record<string, unknown>;

    return (
      typeof kb.name === 'string' &&
      typeof kb.create_time === 'string' &&
      typeof kb.description === 'string' &&
      typeof kb.subfolder === 'string' &&
      typeof kb.organization_rules === 'string'
    );
  }

  it('should validate correct KnowledgeBase', () => {
    const validKB = {
      name: 'my-kb',
      create_time: '2024-01-15T10:30:00Z',
      description: 'Test KB',
      subfolder: 'notes',
      organization_rules: 'Use markdown format.',
    };

    expect(isValidKnowledgeBase(validKB)).toBe(true);
  });

  it('should reject incomplete KnowledgeBase', () => {
    const incompleteKB = {
      name: 'my-kb',
      description: 'Test KB',
      // missing other fields
    };

    expect(isValidKnowledgeBase(incompleteKB)).toBe(false);
  });

  it('should reject wrong types', () => {
    const wrongTypes = {
      name: 123, // should be string
      create_time: '2024-01-15T10:30:00Z',
      description: 'Test KB',
      subfolder: 'notes',
      organization_rules: 'Rules',
    };

    expect(isValidKnowledgeBase(wrongTypes)).toBe(false);
  });
});

describe('FolderConstraint Structure', () => {
  interface FolderConstraint {
    kb_name: string;
    subfolder: string;
    rules: {
      frontmatter?: {
        required_fields?: Array<{
          name: string;
          type: string;
          pattern?: string;
          allowed_values?: unknown[];
        }>;
      };
      filename?: {
        pattern?: string;
      };
      content?: {
        min_length?: number;
        max_length?: number;
        required_sections?: string[];
      };
    };
  }

  function isValidFolderConstraint(obj: unknown): obj is FolderConstraint {
    if (typeof obj !== 'object' || obj === null) return false;

    const fc = obj as Record<string, unknown>;

    if (typeof fc.kb_name !== 'string') return false;
    if (typeof fc.subfolder !== 'string') return false;
    if (typeof fc.rules !== 'object' || fc.rules === null) return false;

    return true;
  }

  it('should validate minimal FolderConstraint', () => {
    const minimal = {
      kb_name: 'my-kb',
      subfolder: 'notes',
      rules: {},
    };

    expect(isValidFolderConstraint(minimal)).toBe(true);
  });

  it('should validate full FolderConstraint', () => {
    const full = {
      kb_name: 'my-kb',
      subfolder: 'notes/daily',
      rules: {
        frontmatter: {
          required_fields: [
            { name: 'title', type: 'string' },
            { name: 'date', type: 'date', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          ],
        },
        filename: {
          pattern: '^\\d{4}-\\d{2}-\\d{2}\\.md$',
        },
        content: {
          min_length: 100,
          required_sections: ['Summary'],
        },
      },
    };

    expect(isValidFolderConstraint(full)).toBe(true);
  });

  it('should reject invalid FolderConstraint', () => {
    expect(isValidFolderConstraint(null)).toBe(false);
    expect(isValidFolderConstraint({ kb_name: 'test' })).toBe(false); // missing fields
    expect(isValidFolderConstraint({ kb_name: 123, subfolder: 'x', rules: {} })).toBe(false);
  });
});
