# Validation Model

This document defines the two-layer validation model used by the LLM Bridges system.

## Overview

Validation is split into two complementary layers:

| Layer | Type | Enforcer | Behavior on Failure |
|-------|------|----------|---------------------|
| **Layer 1** | Machine Validation | System | Reject operation, return error |
| **Layer 2** | Semantic Validation | LLM Agent | Agent issues corrective update |

```
┌─────────────────────────────────────────────────────────┐
│                   Note Operation                        │
│              (create/update/append/move)                │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│           Layer 1: Machine Validation                   │
│                  (Folder Constraints)                   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ • Parse note (frontmatter + body)               │   │
│  │ • Check all applicable constraint rules         │   │
│  │ • Validate field types, patterns, values        │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  Result: PASS → continue | FAIL → reject operation     │
└─────────────────────┬───────────────────────────────────┘
                      │ PASS
                      ▼
┌─────────────────────────────────────────────────────────┐
│              Write File to Vault                        │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│           Layer 2: Semantic Validation                  │
│                (Organization Rules)                     │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ • Return KB metadata + kb_rules                 │   │
│  │ • Return note content (original + updated)      │   │
│  │ • Return validation issues + folder constraint  │   │
│  │ • Include instruction for LLM self-check        │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  LLM Action: Verify → if issues found → update_note    │
└─────────────────────────────────────────────────────────┘
```

---

## Layer 1: Machine Validation (硬規則)

### Purpose

Enforce machine-checkable metadata requirements. Non-compliant operations are **rejected immediately** without writing to the vault.

### Implementation

Based on **Folder Constraints** defined for each KB:

```yaml
rules:
  frontmatter:
    required_fields:
      - name: title
        type: string
      - name: status
        type: string
        allowed_values: ["draft", "review", "published"]

  filename:
    pattern: "^\\d{4}-\\d{2}-\\d{2}-.+\\.md$"
```

### Validation Process

1. **Identify Applicable Constraints**
   - Find all folder constraints where note path starts with constraint's `subfolder`
   - Use most specific match (longest prefix)

2. **Parse Note Content**
   - Extract YAML frontmatter (if present)
   - Identify filename

3. **Apply Validation Rules**
   - Check required frontmatter fields exist
   - Validate field types (string, number, boolean, date, array)
   - Match patterns (regex)
   - Verify allowed values

4. **Return Result**
   - **PASS**: Continue with operation
   - **FAIL**: Reject with structured error

### Error Response Format

```yaml
error:
  code: "folder_constraint_violation"
  message: "Note does not satisfy folder constraint requirements"
  constraint:
    kb_name: "research"
    subfolder: "research/papers"
  issues:
    - field: "frontmatter.status"
      error: "invalid_value"
      expected: ["draft", "review", "published"]
      actual: "pending"

    - field: "frontmatter.created_at"
      error: "missing_required_field"

    - field: "filename"
      error: "pattern_mismatch"
      pattern: "^\\d{4}-\\d{2}-\\d{2}-.+\\.md$"
      actual: "my-note.md"
```

### Validation Rules Reference

#### Frontmatter Field Types

| Type | Description | Example Valid Values |
|------|-------------|---------------------|
| `string` | Text value | `"Hello World"` |
| `number` | Numeric value | `42`, `3.14` |
| `boolean` | True/false | `true`, `false` |
| `date` | ISO date string | `"2025-12-10"` |
| `array` | List of values | `["tag1", "tag2"]` |

#### Pattern Matching

Patterns use standard regex syntax:

```yaml
# Date-prefixed filename
filename:
  pattern: "^\\d{4}-\\d{2}-\\d{2}-.+\\.md$"

# ISO date format
frontmatter:
  required_fields:
    - name: created_at
      type: string
      pattern: "^\\d{4}-\\d{2}-\\d{2}$"
```

#### Allowed Values

Enumerate valid options:

```yaml
frontmatter:
  required_fields:
    - name: status
      type: string
      allowed_values: ["draft", "review", "published"]

    - name: priority
      type: number
      allowed_values: [1, 2, 3, 4, 5]
```

---

## Layer 2: Semantic Validation (語意驗證)

### Purpose

Enable LLM self-verification against human-readable organization rules. The system provides context; the LLM decides if corrections are needed.

### Implementation

Based on **kb_rules** returned in the validation response (derived from KB organization_rules):

```markdown
## Organization Guidelines

1. Each note should focus on a single concept
2. Use descriptive filenames: `YYYY-MM-DD-topic-slug.md`
3. Always include a summary section at the top
4. Link related notes using [[wikilinks]]
5. Tag notes with relevant categories
```

### Response Structure

Every note operation response includes:

```yaml
knowledge_base:
  name: "research"
  subfolder: "research/ai"
  organization_rules: |
    ## Organization Guidelines
    1. Each note should focus on a single concept
    ...

note:
  path: "research/ai/2025-12-10-transformers.md"
  content: |
    ---
    title: Transformer Architecture
    ...
    ---
    # Content...

# For update operations, include original:
original_note:
  path: "research/ai/2025-12-10-transformers.md"
  content: |
    (previous content)

validation:
  kb_rules: |
    ## Organization Guidelines
    1. Each note should focus on a single concept
    ...
  issues: []
  folder_constraint: {}  # Optional, present when a folder constraint applies

validation_instruction_for_llm: |
  Please check your note MUST following rules:

  1. Check that the note content follows the KB rules
  2. Ensure the note structure matches KB conventions
  3. For updates: verify no important information was lost

  If any issues are found, call update_note with corrected content.
```

### LLM Responsibilities

When receiving a validation response, the LLM MUST:

1. **Read kb_rules** from the validation response
2. **Compare note content** against the rules
3. **For updates**: Compare original and updated content to ensure no information loss
4. **If issues found**: Call `update_note` with corrected content
5. **If compliant**: Proceed with next task

### Example LLM Self-Check Flow

```
1. Receive response from create_note
   ↓
2. Extract kb_rules:
   - "Each note should have a summary section"
   - "Use [[wikilinks]] for related notes"
   ↓
3. Check note content:
   - ✓ Has summary section
   - ✗ Missing wikilinks to related concepts
   ↓
4. Issue corrective action:
   → Call update_note with added wikilinks
```

---

## Validation Timing

### By Operation

| Operation | Machine Validation | Semantic Validation |
|-----------|-------------------|---------------------|
| `create_note` | Before write | After write (in response) |
| `update_note` | Before write | After write (in response) |
| `append_note` | Before write | After write (in response) |
| `move_note` | After path change | After move (in response) |
| `delete_note` | N/A | N/A |
| `read_note` | N/A | Optional (validate existing) |

### Pre-write vs Post-write

```
┌──────────────┐     ┌────────────────┐     ┌─────────────┐
│ Tool Called  │ ──► │ Machine Check  │ ──► │ Write File  │
└──────────────┘     └───────┬────────┘     └──────┬──────┘
                             │                     │
                       FAIL: Reject          SUCCESS: Return
                             │                     │
                             ▼                     ▼
                    ┌────────────────┐     ┌─────────────────┐
                    │ Return Error   │     │ Include LLM     │
                    │ (no file       │     │ Validation      │
                    │  written)      │     │ Instructions    │
                    └────────────────┘     └─────────────────┘
```

---

## Error Codes

### Machine Validation Errors

| Code | Description |
|------|-------------|
| `folder_constraint_violation` | Note violates folder constraint rules |
| `missing_required_field` | Required frontmatter field is missing |
| `invalid_field_type` | Field value has wrong type |
| `invalid_value` | Field value not in allowed set |
| `pattern_mismatch` | Field/filename doesn't match pattern |

### Other Errors

| Code | Description |
|------|-------------|
| `knowledge_base_not_found` | Specified KB does not exist |
| `knowledge_base_already_exists` | KB with same name already exists |
| `note_not_found` | Note file does not exist |
| `note_already_exists` | Note file already exists (for create) |
| `invalid_note_path` | Path outside KB scope or malformed |
| `schema_validation_failed` | Constraint definition is invalid |
| `version_conflict` | Concurrent modification detected (if versioning enabled) |

---

## Best Practices

### For Constraint Authors

1. **Start Simple**: Begin with minimal required fields, add complexity as needed
2. **Use Descriptive Patterns**: Prefer readable regex with comments in documentation
3. **Document Rules**: Explain *why* each constraint exists
4. **Test Constraints**: Verify constraints work before deploying

### For LLM Agents

1. **Always Read Validation Response**: Don't skip the validation instructions
2. **Fix Issues Immediately**: Address problems in the same conversation turn
3. **Preserve Information**: For updates, always diff original and new content
4. **Ask When Uncertain**: If kb_rules are ambiguous, clarify with user
