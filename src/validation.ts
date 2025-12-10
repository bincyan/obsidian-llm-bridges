/**
 * Validation Engine for Folder Constraints
 * Based on spec/02-validation-model.md
 */

import {
  ConstraintRules,
  FolderConstraint,
  ParsedNote,
  RequiredField,
  ValidationIssue,
  ValidationResult,
} from './types';

/**
 * Parse a markdown note into frontmatter and body
 */
export function parseNote(content: string): ParsedNote {
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return {
      frontmatter: {},
      body: content,
      raw: content,
    };
  }

  const frontmatterYaml = match[1];
  const body = match[2] || '';

  // Simple YAML parser for frontmatter
  const frontmatter = parseSimpleYaml(frontmatterYaml);

  return {
    frontmatter,
    body,
    raw: content,
  };
}

/**
 * Simple YAML parser for frontmatter
 * Handles basic key-value pairs, arrays, and nested objects
 */
function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split('\n');
  let currentKey: string | null = null;
  let currentArray: unknown[] | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Array item
    if (trimmed.startsWith('- ') && currentKey && currentArray) {
      const value = trimmed.slice(2).trim();
      currentArray.push(parseYamlValue(value));
      continue;
    }

    // Key-value pair
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex > 0) {
      const key = trimmed.slice(0, colonIndex).trim();
      const value = trimmed.slice(colonIndex + 1).trim();

      // Save previous array if exists
      if (currentKey && currentArray) {
        result[currentKey] = currentArray;
        currentArray = null;
      }

      if (value === '' || value === '[]') {
        // Start of array or empty array
        currentKey = key;
        currentArray = [];
      } else if (value.startsWith('[') && value.endsWith(']')) {
        // Inline array
        const arrayContent = value.slice(1, -1);
        result[key] = arrayContent
          .split(',')
          .map((v) => parseYamlValue(v.trim()))
          .filter((v) => v !== '');
        currentKey = null;
        currentArray = null;
      } else {
        result[key] = parseYamlValue(value);
        currentKey = null;
        currentArray = null;
      }
    }
  }

  // Save final array if exists
  if (currentKey && currentArray) {
    result[currentKey] = currentArray;
  }

  return result;
}

/**
 * Parse a YAML value into appropriate JS type
 */
function parseYamlValue(value: string): unknown {
  // Remove quotes
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  // Boolean
  if (value === 'true') return true;
  if (value === 'false') return false;

  // Null
  if (value === 'null' || value === '~') return null;

  // Number
  const num = Number(value);
  if (!isNaN(num) && value !== '') return num;

  // String
  return value;
}

/**
 * Validate a note against folder constraint rules
 */
export function validateNote(
  notePath: string,
  content: string,
  constraint: FolderConstraint
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const parsed = parseNote(content);
  const filename = notePath.split('/').pop() || '';

  // Validate frontmatter rules
  if (constraint.rules.frontmatter?.required_fields) {
    for (const field of constraint.rules.frontmatter.required_fields) {
      const fieldIssues = validateFrontmatterField(parsed.frontmatter, field);
      issues.push(...fieldIssues);
    }
  }

  // Validate filename rules
  if (constraint.rules.filename?.pattern) {
    const filenameIssues = validateFilename(filename, constraint.rules.filename.pattern);
    issues.push(...filenameIssues);
  }

  // Validate content rules
  if (constraint.rules.content) {
    const contentIssues = validateContent(parsed.body, constraint.rules.content);
    issues.push(...contentIssues);
  }

  return {
    passed: issues.length === 0,
    issues,
  };
}

/**
 * Validate a frontmatter field against its requirements
 */
function validateFrontmatterField(
  frontmatter: Record<string, unknown>,
  field: RequiredField
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const value = frontmatter[field.name];
  const fieldPath = `frontmatter.${field.name}`;

  // Check if field exists
  if (value === undefined || value === null) {
    issues.push({
      field: fieldPath,
      error: 'missing_required_field',
      message: `Required field '${field.name}' is missing`,
    });
    return issues;
  }

  // Check type
  const typeValid = validateFieldType(value, field.type);
  if (!typeValid) {
    issues.push({
      field: fieldPath,
      error: 'invalid_field_type',
      expected: field.type,
      actual: typeof value,
      message: `Field '${field.name}' should be type '${field.type}', got '${typeof value}'`,
    });
    return issues; // Skip further validation if type is wrong
  }

  // Check pattern
  if (field.pattern && typeof value === 'string') {
    try {
      const regex = new RegExp(field.pattern);
      if (!regex.test(value)) {
        issues.push({
          field: fieldPath,
          error: 'pattern_mismatch',
          pattern: field.pattern,
          actual: value,
          message: `Field '${field.name}' does not match pattern '${field.pattern}'`,
        });
      }
    } catch {
      // Invalid regex, skip pattern validation
    }
  }

  // Check allowed values
  if (field.allowed_values && field.allowed_values.length > 0) {
    if (!field.allowed_values.includes(value as string | number | boolean)) {
      issues.push({
        field: fieldPath,
        error: 'invalid_value',
        expected: field.allowed_values,
        actual: value,
        message: `Field '${field.name}' must be one of: ${field.allowed_values.join(', ')}`,
      });
    }
  }

  return issues;
}

/**
 * Validate field type matches expected type
 */
function validateFieldType(value: unknown, expectedType: string): boolean {
  switch (expectedType) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number';
    case 'boolean':
      return typeof value === 'boolean';
    case 'date':
      // Date can be a string or Date object
      if (typeof value === 'string') {
        // Check if it's a valid date string (YYYY-MM-DD or ISO format)
        return /^\d{4}-\d{2}-\d{2}/.test(value);
      }
      return value instanceof Date;
    case 'array':
      return Array.isArray(value);
    default:
      return true;
  }
}

/**
 * Validate filename against pattern
 */
function validateFilename(filename: string, pattern: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  try {
    const regex = new RegExp(pattern);
    if (!regex.test(filename)) {
      issues.push({
        field: 'filename',
        error: 'pattern_mismatch',
        pattern,
        actual: filename,
        message: `Filename '${filename}' does not match pattern '${pattern}'`,
      });
    }
  } catch {
    // Invalid regex, skip validation
  }

  return issues;
}

/**
 * Validate content rules
 */
function validateContent(
  body: string,
  rules: ConstraintRules['content']
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!rules) return issues;

  // Check min length
  if (rules.min_length !== undefined && body.length < rules.min_length) {
    issues.push({
      field: 'content',
      error: 'content_too_short',
      expected: rules.min_length,
      actual: body.length,
      message: `Content must be at least ${rules.min_length} characters, got ${body.length}`,
    });
  }

  // Check max length
  if (rules.max_length !== undefined && body.length > rules.max_length) {
    issues.push({
      field: 'content',
      error: 'content_too_long',
      expected: rules.max_length,
      actual: body.length,
      message: `Content must be at most ${rules.max_length} characters, got ${body.length}`,
    });
  }

  // Check required sections
  if (rules.required_sections) {
    for (const section of rules.required_sections) {
      // Look for markdown heading with the section name
      const headingRegex = new RegExp(`^#+\\s+${escapeRegex(section)}\\s*$`, 'im');
      if (!headingRegex.test(body)) {
        issues.push({
          field: 'content.sections',
          error: 'missing_section',
          expected: section,
          message: `Required section '${section}' is missing`,
        });
      }
    }
  }

  return issues;
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find the most specific folder constraint for a given note path
 */
export function findApplicableConstraint(
  notePath: string,
  constraints: FolderConstraint[]
): FolderConstraint | null {
  let bestMatch: FolderConstraint | null = null;
  let bestMatchLength = -1;

  for (const constraint of constraints) {
    // Normalize paths for comparison
    const constraintPath = constraint.subfolder.replace(/\/$/, '');
    const noteDir = notePath.substring(0, notePath.lastIndexOf('/'));

    // Check if note path starts with constraint subfolder
    if (notePath.startsWith(constraintPath + '/') || noteDir === constraintPath) {
      if (constraintPath.length > bestMatchLength) {
        bestMatch = constraint;
        bestMatchLength = constraintPath.length;
      }
    }
  }

  return bestMatch;
}

/**
 * Validate constraint rules schema
 */
export function validateConstraintRulesSchema(rules: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (!rules || typeof rules !== 'object') {
    issues.push({
      field: 'rules',
      error: 'invalid_field_type',
      expected: 'object',
      actual: typeof rules,
      message: 'Rules must be an object',
    });
    return { passed: false, issues };
  }

  const rulesObj = rules as Record<string, unknown>;

  // Validate frontmatter rules
  if (rulesObj.frontmatter !== undefined) {
    if (typeof rulesObj.frontmatter !== 'object') {
      issues.push({
        field: 'rules.frontmatter',
        error: 'invalid_field_type',
        expected: 'object',
        actual: typeof rulesObj.frontmatter,
      });
    } else {
      const fm = rulesObj.frontmatter as Record<string, unknown>;
      if (fm.required_fields !== undefined && !Array.isArray(fm.required_fields)) {
        issues.push({
          field: 'rules.frontmatter.required_fields',
          error: 'invalid_field_type',
          expected: 'array',
          actual: typeof fm.required_fields,
        });
      }
    }
  }

  // Validate filename rules
  if (rulesObj.filename !== undefined) {
    if (typeof rulesObj.filename !== 'object') {
      issues.push({
        field: 'rules.filename',
        error: 'invalid_field_type',
        expected: 'object',
        actual: typeof rulesObj.filename,
      });
    } else {
      const fn = rulesObj.filename as Record<string, unknown>;
      if (fn.pattern !== undefined && typeof fn.pattern !== 'string') {
        issues.push({
          field: 'rules.filename.pattern',
          error: 'invalid_field_type',
          expected: 'string',
          actual: typeof fn.pattern,
        });
      }
      // Validate regex pattern is valid
      if (typeof fn.pattern === 'string') {
        try {
          new RegExp(fn.pattern);
        } catch {
          issues.push({
            field: 'rules.filename.pattern',
            error: 'invalid_value',
            actual: fn.pattern,
            message: 'Invalid regex pattern',
          });
        }
      }
    }
  }

  // Validate content rules
  if (rulesObj.content !== undefined) {
    if (typeof rulesObj.content !== 'object') {
      issues.push({
        field: 'rules.content',
        error: 'invalid_field_type',
        expected: 'object',
        actual: typeof rulesObj.content,
      });
    }
  }

  return {
    passed: issues.length === 0,
    issues,
  };
}
