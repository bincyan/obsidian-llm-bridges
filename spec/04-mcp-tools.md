# MCP Tools Specification

This document provides the complete specification for all MCP tools exposed by the LLM Bridges system.

## Common Conventions

### Naming Convention

Tools use `verb_noun` or `verb_noun_modifier` naming:

```
list_knowledge_bases
add_knowledge_base
update_knowledge_base
add_knowledge_base_folder_constraint
create_note
update_note
append_note
move_note
delete_note
read_note
list_notes
```

### Common Parameters

All note operations require:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `knowledge_base_name` | string | Yes | Name of the KB to operate within |

### Error Codes

| Code | Description |
|------|-------------|
| `knowledge_base_not_found` | Specified KB does not exist |
| `knowledge_base_already_exists` | KB with same name already exists |
| `folder_constraint_violation` | Note violates folder constraint rules |
| `note_not_found` | Note file does not exist |
| `note_already_exists` | Note file already exists (for create) |
| `invalid_note_path` | Path outside KB scope or malformed |
| `schema_validation_failed` | Constraint definition is invalid |
| `subfolder_overlap` | KB subfolder overlaps with existing KB |
| `version_conflict` | Concurrent modification detected (optional) |

---

## Knowledge Base Tools

### `list_knowledge_bases`

**Purpose**: List all defined Knowledge Bases.

#### Input

None.

#### Output

```yaml
knowledge_bases:
  - name: string
    description: string
    subfolder: string
    create_time: ISO8601
    organization_rules_preview: string  # Optional: truncated preview
```

#### Example Response

```json
{
  "knowledge_bases": [
    {
      "name": "ai-research",
      "description": "AI/ML research papers and concepts",
      "subfolder": "research/ai",
      "create_time": "2025-12-10T14:30:00Z",
      "organization_rules_preview": "1. Each note focuses on single concept..."
    },
    {
      "name": "daily-notes",
      "description": "Daily journal entries",
      "subfolder": "journal/daily",
      "create_time": "2025-12-01T09:00:00Z",
      "organization_rules_preview": "Daily entries with date-based naming..."
    }
  ]
}
```

---

### `add_knowledge_base`

**Purpose**: Create a new Knowledge Base and persist its metadata.

#### Input

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Unique KB identifier |
| `description` | string | Yes | Human-readable description |
| `subfolder` | string | Yes | Vault-relative root for this KB |
| `organization_rules` | string | Yes | Human-readable organization guidelines |

#### Behavior

1. Validate `name` is unique across all KBs
2. Validate `subfolder` does not overlap with existing KB subfolders
3. Create directory structure: `.llm_bridges/knowledge_base/{name}/`
4. Persist metadata to `meta.md`
5. Return complete KB object with guidance

#### Output

```yaml
knowledge_base:
  name: string
  create_time: ISO8601
  description: string
  subfolder: string
  organization_rules: string

next_steps: string  # Guidance for agent
```

#### Errors

- `knowledge_base_already_exists`: KB with same name exists
- `subfolder_overlap`: Subfolder overlaps with existing KB

#### Example

**Request:**
```json
{
  "name": "ai-research",
  "description": "AI/ML research papers and concepts",
  "subfolder": "research/ai",
  "organization_rules": "## Guidelines\n1. One concept per note\n2. Use date-prefixed filenames..."
}
```

**Response:**
```json
{
  "knowledge_base": {
    "name": "ai-research",
    "create_time": "2025-12-10T14:30:00Z",
    "description": "AI/ML research papers and concepts",
    "subfolder": "research/ai",
    "organization_rules": "## Guidelines\n1. One concept per note..."
  },
  "next_steps": "Knowledge base created. Please define folder constraints using add_knowledge_base_folder_constraint to specify machine-checkable metadata rules for notes under specific subfolders."
}
```

---

### `update_knowledge_base`

**Purpose**: Update metadata of an existing KB.

#### Input

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | KB name to update |
| `description` | string | No | New description |
| `subfolder` | string | No | New subfolder path |
| `organization_rules` | string | No | New organization rules |

#### Behavior

1. Load existing KB by name
2. Apply partial update of provided fields
3. If `subfolder` changes, validate no overlap with other KBs
4. Persist updated metadata to `meta.md`
5. Return updated KB object

#### Output

```yaml
knowledge_base:
  name: string
  create_time: ISO8601  # Original, unchanged
  description: string
  subfolder: string
  organization_rules: string

notes:
  - message: string  # Optional warnings about subfolder changes
```

#### Errors

- `knowledge_base_not_found`: KB does not exist
- `subfolder_overlap`: New subfolder overlaps with existing KB

---

### `add_knowledge_base_folder_constraint`

**Purpose**: Declare machine-checkable constraint for notes under a specific subfolder.

#### Input

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `kb_name` | string | Yes | Name of the KB |
| `subfolder` | string | Yes | Target folder path (vault-relative) |
| `rules` | object | Yes | Structured metadata requirements |

#### Rules Schema

```yaml
rules:
  frontmatter:
    required_fields:
      - name: string           # Field name
        type: string           # string|number|boolean|date|array
        pattern: string        # Optional: regex pattern
        allowed_values: array  # Optional: enumerated values

  filename:
    pattern: string            # Regex pattern for valid filenames

  content:
    min_length: number         # Optional: minimum characters
    max_length: number         # Optional: maximum characters
    required_sections: array   # Optional: required headings
```

#### Behavior

1. Validate KB exists
2. Normalize subfolder to vault-relative path
3. Validate subfolder is within KB's subfolder scope
4. Persist constraint to `.llm_bridges/knowledge_base/{kb_name}/folder_constraints/`
5. If constraint exists for same subfolder: overwrite (or reject - implementation choice)

#### Output

```yaml
folder_constraint:
  kb_name: string
  subfolder: string
  rules: object
```

#### Errors

- `knowledge_base_not_found`: KB does not exist
- `invalid_note_path`: Subfolder outside KB scope
- `schema_validation_failed`: Rules schema is invalid

#### Example

**Request:**
```json
{
  "kb_name": "ai-research",
  "subfolder": "research/ai/papers",
  "rules": {
    "frontmatter": {
      "required_fields": [
        {"name": "title", "type": "string"},
        {"name": "authors", "type": "array"},
        {"name": "published_date", "type": "date", "pattern": "^\\d{4}-\\d{2}-\\d{2}$"},
        {"name": "status", "type": "string", "allowed_values": ["reading", "read", "summarized"]},
        {"name": "tags", "type": "array"}
      ]
    },
    "filename": {
      "pattern": "^\\d{4}-\\d{2}-\\d{2}-[a-z0-9-]+\\.md$"
    }
  }
}
```

**Response:**
```json
{
  "folder_constraint": {
    "kb_name": "ai-research",
    "subfolder": "research/ai/papers",
    "rules": {
      "frontmatter": {...},
      "filename": {...}
    }
  }
}
```

---

## Note Tools

### `create_note`

**Purpose**: Create a new note under a KB.

#### Input

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `knowledge_base_name` | string | Yes | KB to create note in |
| `note_path` | string | Yes | Path for the note (relative to KB subfolder) |
| `note_content` | string | Yes | Full Markdown content |

#### Behavior

1. Resolve final path: `KB.subfolder + "/" + note_path`
2. Validate path is within KB scope
3. Check note does not already exist
4. Find applicable folder constraints
5. **Machine validation**: Validate content against constraints
   - If FAIL: Reject, return error, do NOT write file
   - If PASS: Continue
6. Write file to vault
7. Return KB metadata, note content, and validation instructions

#### Output

```yaml
knowledge_base:
  name: string
  subfolder: string
  organization_rules: string

note:
  path: string
  content: string

machine_validation:
  passed: boolean
  issues: array  # Empty if passed

validation_instruction_for_llm: string
```

#### Errors

- `knowledge_base_not_found`: KB does not exist
- `note_already_exists`: Note file already exists
- `invalid_note_path`: Path outside KB scope
- `folder_constraint_violation`: Content violates constraints

#### Example Response (Success)

```json
{
  "knowledge_base": {
    "name": "ai-research",
    "subfolder": "research/ai",
    "organization_rules": "## Guidelines\n1. One concept per note..."
  },
  "note": {
    "path": "research/ai/papers/2025-12-10-transformers.md",
    "content": "---\ntitle: Transformer Architecture\n..."
  },
  "machine_validation": {
    "passed": true,
    "issues": []
  },
  "validation_instruction_for_llm": "Please verify the note against the knowledge base's organization_rules:\n\n1. Check that the note content follows the organization guidelines\n2. Ensure the note structure matches KB conventions\n\nIf any issues are found, call update_note with corrected content."
}
```

#### Example Response (Constraint Violation)

```json
{
  "error": {
    "code": "folder_constraint_violation",
    "message": "Note does not satisfy folder constraint requirements",
    "constraint": {
      "kb_name": "ai-research",
      "subfolder": "research/ai/papers"
    },
    "issues": [
      {
        "field": "frontmatter.status",
        "error": "invalid_value",
        "expected": ["reading", "read", "summarized"],
        "actual": "pending"
      },
      {
        "field": "filename",
        "error": "pattern_mismatch",
        "pattern": "^\\d{4}-\\d{2}-\\d{2}-[a-z0-9-]+\\.md$",
        "actual": "transformers.md"
      }
    ]
  }
}
```

---

### `update_note`

**Purpose**: Replace entire content of an existing note.

#### Input

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `knowledge_base_name` | string | Yes | KB containing the note |
| `note_path` | string | Yes | Path to the note |
| `note_content` | string | Yes | New full Markdown content |
| `expected_version` | string | No | Optional: for concurrent-safe updates |

#### Behavior

1. Resolve and validate path
2. Check note exists
3. Read original content
4. **Machine validation** on new content
   - If FAIL: Reject, do NOT overwrite
5. If versioning enabled and `expected_version` mismatches: reject
6. Write new content
7. Return original and updated content for comparison

#### Output

```yaml
knowledge_base:
  name: string
  subfolder: string
  organization_rules: string

original_note:
  path: string
  content: string

updated_note:
  path: string
  content: string

machine_validation:
  passed: boolean
  issues: array

validation_instruction_for_llm: string
```

#### Validation Instruction

```
Please verify the update against the knowledge base's organization_rules:

1. Compare original and updated content to ensure no important information was lost
2. Check that the updated note follows the organization guidelines
3. Verify the note structure matches KB conventions

If any issues are found, call update_note again with corrected content.
```

#### Errors

- `knowledge_base_not_found`
- `note_not_found`: Note does not exist
- `invalid_note_path`
- `folder_constraint_violation`
- `version_conflict`: If versioning enabled

---

### `append_note`

**Purpose**: Append content to an existing note.

#### Input

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `knowledge_base_name` | string | Yes | KB containing the note |
| `note_path` | string | Yes | Path to the note |
| `note_content` | string | Yes | Content to append |

#### Behavior

1. Resolve and validate path
2. Check note exists
3. Read original content
4. Construct new content: `original + "\n" + note_content`
5. **Machine validation** on resulting content
   - If FAIL: Reject, do NOT write
6. Write updated content
7. Return original and updated content

#### Output

Same structure as `update_note`.

#### Errors

Same as `update_note`.

---

### `move_note`

**Purpose**: Move a note to a new path within the same KB.

#### Input

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `knowledge_base_name` | string | Yes | KB containing the note |
| `origin_note_path` | string | Yes | Current path |
| `new_note_path` | string | Yes | Destination path |

#### Behavior

1. Resolve both paths within KB scope
2. Validate origin exists
3. Check destination does not exist (no overwrite)
4. Read note content
5. **Machine validation** against new path's constraints
   - If FAIL: Reject move (note stays at origin)
6. Move file to new location
7. Return move result with validation info

#### Output

```yaml
knowledge_base:
  name: string
  subfolder: string
  organization_rules: string

origin_path: string
new_path: string

machine_validation:
  passed: boolean
  issues: array

validation_instruction_for_llm: string  # Optional
```

#### Errors

- `knowledge_base_not_found`
- `note_not_found`: Origin does not exist
- `note_already_exists`: Destination already exists
- `invalid_note_path`: Either path outside KB scope
- `folder_constraint_violation`: Note doesn't meet new folder's constraints

---

### `delete_note`

**Purpose**: Delete a note from the vault.

#### Input

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `knowledge_base_name` | string | Yes | KB containing the note |
| `note_path` | string | Yes | Path to the note |

#### Behavior

1. Resolve and validate path
2. Check note exists (or treat as idempotent success - implementation choice)
3. Delete file
4. Return confirmation

#### Output

```yaml
knowledge_base:
  name: string
  subfolder: string

deleted_path: string
```

#### Errors

- `knowledge_base_not_found`
- `note_not_found`: Note does not exist (if not idempotent)
- `invalid_note_path`

---

### `read_note`

**Purpose**: Read a note's content with optional pagination.

#### Input

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `knowledge_base_name` | string | Yes | - | KB containing the note |
| `note_path` | string | Yes | - | Path to the note |
| `offset` | integer | No | 0 | Character offset to start reading |
| `limit` | integer | No | 10000 | Maximum characters to return |

#### Behavior

1. Resolve and validate path
2. Check note exists
3. Read full content
4. Return slice from `offset` to `offset + limit`
5. Indicate if more content remains

#### Output

```yaml
knowledge_base:
  name: string
  subfolder: string
  organization_rules: string

note:
  path: string
  content: string        # The returned chunk
  offset: integer        # Start index of this chunk
  next_offset: integer   # Offset for next chunk
  has_more: boolean
  remaining_chars: integer
```

#### Pagination Example

```
Note content: 25,000 characters
Request: offset=0, limit=10000

Response:
  content: (first 10,000 chars)
  offset: 0
  next_offset: 10000
  has_more: true
  remaining_chars: 15000

Next request: offset=10000, limit=10000

Response:
  content: (next 10,000 chars)
  offset: 10000
  next_offset: 20000
  has_more: true
  remaining_chars: 5000

... continue until has_more=false
```

#### Errors

- `knowledge_base_not_found`
- `note_not_found`
- `invalid_note_path`

---

### `list_notes`

**Purpose**: List notes managed under a KB.

#### Input

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `knowledge_base_name` | string | Yes | KB to list notes from |
| `subfolder` | string | No | Optional: filter to specific subfolder |

#### Behavior

1. Validate KB exists
2. List all `.md` files under KB's subfolder (or specified subfolder filter)
3. Return list of note paths

#### Output

```yaml
knowledge_base:
  name: string
  subfolder: string

notes:
  - path: string  # Vault-relative paths
  - path: string
  - ...
```

#### Example

```json
{
  "knowledge_base": {
    "name": "ai-research",
    "subfolder": "research/ai"
  },
  "notes": [
    {"path": "research/ai/papers/2025-12-10-transformers.md"},
    {"path": "research/ai/papers/2025-12-08-attention.md"},
    {"path": "research/ai/concepts/backpropagation.md"}
  ]
}
```

#### Errors

- `knowledge_base_not_found`

---

## Optional Tools

### `validate_note` (Optional Extension)

**Purpose**: Re-validate an existing note without modification.

#### Input

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `knowledge_base_name` | string | Yes | KB containing the note |
| `note_path` | string | Yes | Path to the note |

#### Behavior

1. Resolve and validate path
2. Read current note content
3. Apply folder constraints (machine validation)
4. Return validation result with organization_rules

#### Output

```yaml
knowledge_base:
  name: string
  subfolder: string
  organization_rules: string

note:
  path: string
  content: string  # Full content or chunked

machine_validation:
  passed: boolean
  issues: array

validation_instruction_for_llm: string
```

#### Use Cases

- Lint entire folder for compliance
- Re-validate after constraint changes
- Audit existing notes

---

## Response Summary Matrix

| Tool | Returns KB | Returns Note | Returns Original | Validation |
|------|------------|--------------|------------------|------------|
| `list_knowledge_bases` | List | - | - | - |
| `add_knowledge_base` | Full | - | - | - |
| `update_knowledge_base` | Full | - | - | - |
| `add_knowledge_base_folder_constraint` | - | - | - | - |
| `create_note` | Full | Content | - | Machine + LLM instruction |
| `update_note` | Full | Updated | Original | Machine + LLM instruction |
| `append_note` | Full | Updated | Original | Machine + LLM instruction |
| `move_note` | Full | Paths | - | Machine + LLM instruction |
| `delete_note` | Partial | Path | - | - |
| `read_note` | Full | Chunked | - | - |
| `list_notes` | Partial | Paths | - | - |
| `validate_note` | Full | Content | - | Machine + LLM instruction |
