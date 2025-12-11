/**
 * Unit tests for validation.ts
 * Tests the validation engine for folder constraints
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseNote,
  validateNote,
  findApplicableConstraint,
  validateConstraintRulesSchema,
} from '../../src/validation';
import type { FolderConstraint, ParsedNote } from '../../src/types';

describe('parseNote', () => {
  describe('frontmatter parsing', () => {
    it('should parse note with valid frontmatter', () => {
      const content = `---
title: My Note
tags: [tag1, tag2]
date: 2024-01-15
---

# Content here`;

      const result = parseNote(content);

      expect(result.frontmatter.title).toBe('My Note');
      expect(result.frontmatter.tags).toEqual(['tag1', 'tag2']);
      expect(result.frontmatter.date).toBe('2024-01-15');
      expect(result.body).toContain('# Content here');
    });

    it('should handle note without frontmatter', () => {
      const content = '# Just a heading\n\nSome content';

      const result = parseNote(content);

      expect(result.frontmatter).toEqual({});
      expect(result.body).toBe(content);
    });

    it('should handle empty frontmatter', () => {
      // Note: Empty frontmatter still needs a newline between --- markers
      const content = `---

---

Content`;

      const result = parseNote(content);

      expect(result.frontmatter).toEqual({});
      expect(result.body.trim()).toBe('Content');
    });

    it('should parse boolean values', () => {
      const content = `---
published: true
draft: false
---`;

      const result = parseNote(content);

      expect(result.frontmatter.published).toBe(true);
      expect(result.frontmatter.draft).toBe(false);
    });

    it('should parse numeric values', () => {
      const content = `---
count: 42
rating: 4.5
---`;

      const result = parseNote(content);

      expect(result.frontmatter.count).toBe(42);
      expect(result.frontmatter.rating).toBe(4.5);
    });

    it('should parse null values', () => {
      const content = `---
empty: null
tilde: ~
---`;

      const result = parseNote(content);

      expect(result.frontmatter.empty).toBeNull();
      expect(result.frontmatter.tilde).toBeNull();
    });

    it('should parse quoted strings', () => {
      const content = `---
single: 'hello world'
double: "foo bar"
---`;

      const result = parseNote(content);

      expect(result.frontmatter.single).toBe('hello world');
      expect(result.frontmatter.double).toBe('foo bar');
    });

    it('should parse array with dashes', () => {
      const content = `---
items:
- item1
- item2
- item3
---`;

      const result = parseNote(content);

      expect(result.frontmatter.items).toEqual(['item1', 'item2', 'item3']);
    });

    it('should handle Windows line endings (CRLF)', () => {
      const content = '---\r\ntitle: Test\r\n---\r\n\r\nBody content';

      const result = parseNote(content);

      expect(result.frontmatter.title).toBe('Test');
      expect(result.body.trim()).toBe('Body content');
    });
  });

  describe('edge cases', () => {
    it('should handle content that looks like frontmatter but is not', () => {
      const content = 'Some text\n---\nnot: frontmatter\n---';

      const result = parseNote(content);

      expect(result.frontmatter).toEqual({});
      expect(result.body).toBe(content);
    });

    it('should preserve raw content', () => {
      const content = `---
title: Test
---
Body`;

      const result = parseNote(content);

      expect(result.raw).toBe(content);
    });
  });
});

describe('validateNote', () => {
  let constraint: FolderConstraint;

  beforeEach(() => {
    constraint = {
      kb_name: 'test-kb',
      subfolder: 'notes',
      rules: {},
    };
  });

  describe('frontmatter validation', () => {
    it('should pass when required field is present', () => {
      constraint.rules.frontmatter = {
        required_fields: [{ name: 'title', type: 'string' }],
      };

      const content = `---
title: My Note
---
Content`;

      const result = validateNote('notes/test.md', content, constraint);

      expect(result.passed).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should fail when required field is missing', () => {
      constraint.rules.frontmatter = {
        required_fields: [{ name: 'title', type: 'string' }],
      };

      const content = `---
author: John
---
Content`;

      const result = validateNote('notes/test.md', content, constraint);

      expect(result.passed).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].error).toBe('missing_required_field');
      expect(result.issues[0].field).toBe('frontmatter.title');
    });

    it('should fail when field type is wrong', () => {
      constraint.rules.frontmatter = {
        required_fields: [{ name: 'count', type: 'number' }],
      };

      const content = `---
count: not-a-number
---`;

      const result = validateNote('notes/test.md', content, constraint);

      expect(result.passed).toBe(false);
      expect(result.issues[0].error).toBe('invalid_field_type');
      expect(result.issues[0].expected).toBe('number');
    });

    it('should validate string type', () => {
      constraint.rules.frontmatter = {
        required_fields: [{ name: 'title', type: 'string' }],
      };

      const content = `---
title: Valid String
---`;

      const result = validateNote('notes/test.md', content, constraint);

      expect(result.passed).toBe(true);
    });

    it('should validate number type', () => {
      constraint.rules.frontmatter = {
        required_fields: [{ name: 'rating', type: 'number' }],
      };

      const content = `---
rating: 4.5
---`;

      const result = validateNote('notes/test.md', content, constraint);

      expect(result.passed).toBe(true);
    });

    it('should validate boolean type', () => {
      constraint.rules.frontmatter = {
        required_fields: [{ name: 'published', type: 'boolean' }],
      };

      const content = `---
published: true
---`;

      const result = validateNote('notes/test.md', content, constraint);

      expect(result.passed).toBe(true);
    });

    it('should validate date type with ISO format', () => {
      constraint.rules.frontmatter = {
        required_fields: [{ name: 'created', type: 'date' }],
      };

      const content = `---
created: 2024-01-15
---`;

      const result = validateNote('notes/test.md', content, constraint);

      expect(result.passed).toBe(true);
    });

    it('should fail date validation for invalid format', () => {
      constraint.rules.frontmatter = {
        required_fields: [{ name: 'created', type: 'date' }],
      };

      const content = `---
created: January 15, 2024
---`;

      const result = validateNote('notes/test.md', content, constraint);

      expect(result.passed).toBe(false);
      expect(result.issues[0].error).toBe('invalid_field_type');
    });

    it('should validate array type', () => {
      constraint.rules.frontmatter = {
        required_fields: [{ name: 'tags', type: 'array' }],
      };

      const content = `---
tags: [tag1, tag2]
---`;

      const result = validateNote('notes/test.md', content, constraint);

      expect(result.passed).toBe(true);
    });

    it('should validate pattern matching', () => {
      constraint.rules.frontmatter = {
        required_fields: [
          { name: 'email', type: 'string', pattern: '^[\\w.-]+@[\\w.-]+\\.\\w+$' },
        ],
      };

      const validContent = `---
email: test@example.com
---`;

      const invalidContent = `---
email: not-an-email
---`;

      expect(validateNote('notes/test.md', validContent, constraint).passed).toBe(true);
      expect(validateNote('notes/test.md', invalidContent, constraint).passed).toBe(false);
    });

    it('should validate allowed values', () => {
      constraint.rules.frontmatter = {
        required_fields: [
          { name: 'status', type: 'string', allowed_values: ['draft', 'published', 'archived'] },
        ],
      };

      const validContent = `---
status: published
---`;

      const invalidContent = `---
status: deleted
---`;

      const validResult = validateNote('notes/test.md', validContent, constraint);
      const invalidResult = validateNote('notes/test.md', invalidContent, constraint);

      expect(validResult.passed).toBe(true);
      expect(invalidResult.passed).toBe(false);
      expect(invalidResult.issues[0].error).toBe('invalid_value');
    });

    it('should validate multiple required fields', () => {
      constraint.rules.frontmatter = {
        required_fields: [
          { name: 'title', type: 'string' },
          { name: 'date', type: 'date' },
          { name: 'tags', type: 'array' },
        ],
      };

      const content = `---
title: Test
date: 2024-01-15
tags: [a, b]
---`;

      const result = validateNote('notes/test.md', content, constraint);

      expect(result.passed).toBe(true);
    });

    it('should report all missing fields', () => {
      constraint.rules.frontmatter = {
        required_fields: [
          { name: 'title', type: 'string' },
          { name: 'date', type: 'date' },
        ],
      };

      const content = `---
author: John
---`;

      const result = validateNote('notes/test.md', content, constraint);

      expect(result.passed).toBe(false);
      expect(result.issues).toHaveLength(2);
    });
  });

  describe('filename validation', () => {
    it('should pass when filename matches pattern', () => {
      constraint.rules.filename = {
        pattern: '^\\d{4}-\\d{2}-\\d{2}-.+\\.md$',
      };

      const content = '---\ntitle: Test\n---';

      const result = validateNote('notes/2024-01-15-my-note.md', content, constraint);

      expect(result.passed).toBe(true);
    });

    it('should fail when filename does not match pattern', () => {
      constraint.rules.filename = {
        pattern: '^\\d{4}-\\d{2}-\\d{2}-.+\\.md$',
      };

      const content = '---\ntitle: Test\n---';

      const result = validateNote('notes/my-note.md', content, constraint);

      expect(result.passed).toBe(false);
      expect(result.issues[0].error).toBe('pattern_mismatch');
      expect(result.issues[0].field).toBe('filename');
    });

    it('should handle invalid regex gracefully', () => {
      constraint.rules.filename = {
        pattern: '[invalid regex',
      };

      const content = '---\ntitle: Test\n---';

      // Should not throw, just skip validation
      const result = validateNote('notes/test.md', content, constraint);

      expect(result.passed).toBe(true);
    });
  });

  describe('content validation', () => {
    it('should pass when content meets min_length', () => {
      constraint.rules.content = {
        min_length: 10,
      };

      const content = `---
title: Test
---
This is enough content to pass the minimum length requirement.`;

      const result = validateNote('notes/test.md', content, constraint);

      expect(result.passed).toBe(true);
    });

    it('should fail when content is too short', () => {
      constraint.rules.content = {
        min_length: 100,
      };

      const content = `---
title: Test
---
Short`;

      const result = validateNote('notes/test.md', content, constraint);

      expect(result.passed).toBe(false);
      expect(result.issues[0].error).toBe('content_too_short');
    });

    it('should fail when content exceeds max_length', () => {
      constraint.rules.content = {
        max_length: 10,
      };

      const content = `---
title: Test
---
This content is way too long for the maximum length requirement.`;

      const result = validateNote('notes/test.md', content, constraint);

      expect(result.passed).toBe(false);
      expect(result.issues[0].error).toBe('content_too_long');
    });

    it('should validate required sections', () => {
      constraint.rules.content = {
        required_sections: ['Summary', 'Details'],
      };

      const validContent = `---
title: Test
---

# Summary
This is the summary.

# Details
These are the details.`;

      const invalidContent = `---
title: Test
---

# Summary
Only has summary.`;

      expect(validateNote('notes/test.md', validContent, constraint).passed).toBe(true);
      expect(validateNote('notes/test.md', invalidContent, constraint).passed).toBe(false);
    });

    it('should find sections with any heading level', () => {
      constraint.rules.content = {
        required_sections: ['Overview'],
      };

      const content1 = `---\n---\n# Overview\nContent`;
      const content2 = `---\n---\n## Overview\nContent`;
      const content3 = `---\n---\n### Overview\nContent`;

      expect(validateNote('notes/test.md', content1, constraint).passed).toBe(true);
      expect(validateNote('notes/test.md', content2, constraint).passed).toBe(true);
      expect(validateNote('notes/test.md', content3, constraint).passed).toBe(true);
    });
  });

  describe('combined validations', () => {
    it('should validate all rules together', () => {
      constraint.rules = {
        frontmatter: {
          required_fields: [{ name: 'title', type: 'string' }],
        },
        filename: {
          pattern: '\\.md$',
        },
        content: {
          min_length: 5,
          required_sections: ['Introduction'],
        },
      };

      const validContent = `---
title: My Document
---

# Introduction
This is the introduction section with enough content.`;

      const result = validateNote('notes/doc.md', validContent, constraint);

      expect(result.passed).toBe(true);
    });

    it('should collect all validation issues', () => {
      constraint.rules = {
        frontmatter: {
          required_fields: [{ name: 'title', type: 'string' }],
        },
        filename: {
          pattern: '^\\d{4}-.+$',
        },
        content: {
          required_sections: ['Summary'],
        },
      };

      const content = `---
author: John
---
No summary section here.`;

      const result = validateNote('notes/bad-file.md', content, constraint);

      expect(result.passed).toBe(false);
      expect(result.issues.length).toBeGreaterThanOrEqual(3);
    });
  });
});

describe('findApplicableConstraint', () => {
  const constraints: FolderConstraint[] = [
    {
      kb_name: 'kb1',
      subfolder: 'docs',
      rules: { frontmatter: { required_fields: [{ name: 'a', type: 'string' }] } },
    },
    {
      kb_name: 'kb1',
      subfolder: 'docs/api',
      rules: { frontmatter: { required_fields: [{ name: 'b', type: 'string' }] } },
    },
    {
      kb_name: 'kb1',
      subfolder: 'docs/api/v2',
      rules: { frontmatter: { required_fields: [{ name: 'c', type: 'string' }] } },
    },
    {
      kb_name: 'kb2',
      subfolder: 'notes',
      rules: {},
    },
  ];

  it('should return null for non-matching path', () => {
    const result = findApplicableConstraint('other/file.md', constraints);
    expect(result).toBeNull();
  });

  it('should match root constraint', () => {
    const result = findApplicableConstraint('docs/readme.md', constraints);
    expect(result?.subfolder).toBe('docs');
  });

  it('should match most specific (deepest) constraint', () => {
    const result = findApplicableConstraint('docs/api/v2/endpoint.md', constraints);
    expect(result?.subfolder).toBe('docs/api/v2');
  });

  it('should match intermediate constraint', () => {
    const result = findApplicableConstraint('docs/api/overview.md', constraints);
    expect(result?.subfolder).toBe('docs/api');
  });

  it('should match exact folder', () => {
    const result = findApplicableConstraint('notes/todo.md', constraints);
    expect(result?.kb_name).toBe('kb2');
  });

  it('should handle trailing slashes in constraint paths', () => {
    const constraintsWithSlash: FolderConstraint[] = [
      { kb_name: 'kb', subfolder: 'projects/', rules: {} },
    ];

    const result = findApplicableConstraint('projects/test.md', constraintsWithSlash);
    expect(result).not.toBeNull();
  });
});

describe('validateConstraintRulesSchema', () => {
  it('should pass for valid empty rules', () => {
    const result = validateConstraintRulesSchema({});
    expect(result.passed).toBe(true);
  });

  it('should fail for non-object rules', () => {
    const result = validateConstraintRulesSchema('not an object');
    expect(result.passed).toBe(false);
    expect(result.issues[0].error).toBe('invalid_field_type');
  });

  it('should fail for null rules', () => {
    const result = validateConstraintRulesSchema(null);
    expect(result.passed).toBe(false);
  });

  it('should validate frontmatter structure', () => {
    const validRules = {
      frontmatter: {
        required_fields: [{ name: 'title', type: 'string' }],
      },
    };

    const invalidRules = {
      frontmatter: 'not an object',
    };

    expect(validateConstraintRulesSchema(validRules).passed).toBe(true);
    expect(validateConstraintRulesSchema(invalidRules).passed).toBe(false);
  });

  it('should validate required_fields is array', () => {
    const invalidRules = {
      frontmatter: {
        required_fields: 'not an array',
      },
    };

    const result = validateConstraintRulesSchema(invalidRules);
    expect(result.passed).toBe(false);
    expect(result.issues[0].field).toBe('rules.frontmatter.required_fields');
  });

  it('should validate filename structure', () => {
    const validRules = {
      filename: {
        pattern: '^.*\\.md$',
      },
    };

    const invalidRules = {
      filename: 'not an object',
    };

    expect(validateConstraintRulesSchema(validRules).passed).toBe(true);
    expect(validateConstraintRulesSchema(invalidRules).passed).toBe(false);
  });

  it('should validate filename pattern is string', () => {
    const invalidRules = {
      filename: {
        pattern: 123,
      },
    };

    const result = validateConstraintRulesSchema(invalidRules);
    expect(result.passed).toBe(false);
  });

  it('should validate filename pattern is valid regex', () => {
    const invalidRules = {
      filename: {
        pattern: '[invalid',
      },
    };

    const result = validateConstraintRulesSchema(invalidRules);
    expect(result.passed).toBe(false);
    expect(result.issues[0].message).toBe('Invalid regex pattern');
  });

  it('should validate content structure', () => {
    const validRules = {
      content: {
        min_length: 100,
        max_length: 10000,
        required_sections: ['Summary'],
      },
    };

    const invalidRules = {
      content: 'not an object',
    };

    expect(validateConstraintRulesSchema(validRules).passed).toBe(true);
    expect(validateConstraintRulesSchema(invalidRules).passed).toBe(false);
  });
});
