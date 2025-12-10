# Core Concepts & Entities

This document defines the core entities and concepts used throughout the LLM Bridges system.

## 1. Vault

The Obsidian vault is the root container for all content.

### Properties

| Property | Description |
|----------|-------------|
| Root Path | Absolute filesystem path to the vault directory |
| Management Directory | `.llm_bridges/` at vault root for system metadata |

### Constraints

- The system operates on a **single** Obsidian vault per MCP server instance
- All paths in the system are **vault-relative** (relative to vault root)

---

## 2. Knowledge Base (KB)

A Knowledge Base is a logical namespace that governs a subset of the vault.

### Purpose

- Define which notes it manages (via `subfolder`)
- Specify how notes should be organized (via `organization_rules` and folder constraints)
- Scope all note operations to prevent uncontrolled vault modifications

### Schema

```yaml
name: string              # Unique identifier for the KB
create_time: ISO8601      # Timestamp when KB was created
description: string       # Human-readable description of KB purpose
subfolder: string         # Vault-relative folder this KB manages
organization_rules: text  # Free-form Markdown describing organization principles
```

### Field Definitions

#### `name`
- **Type**: String
- **Constraints**: Unique across all KBs, URL-safe characters recommended
- **Example**: `"ai-research"`, `"daily-notes"`, `"project-docs"`

#### `create_time`
- **Type**: ISO 8601 timestamp
- **Purpose**: Track KB creation for auditing and versioning
- **Example**: `"2025-12-10T14:30:00Z"`

#### `description`
- **Type**: String
- **Purpose**: Human-readable explanation of what this KB is for
- **Example**: `"Knowledge base for AI/ML research papers and notes"`

#### `subfolder`
- **Type**: String (vault-relative path)
- **Purpose**: Defines the root scope for all note operations of this KB
- **Constraints**:
  - All note operations for this KB are restricted to paths under this subfolder
  - Recommended: Avoid overlapping subfolders between KBs
- **Example**: `"research/ai"`, `"projects/project-alpha"`

#### `organization_rules`
- **Type**: Free-form text (Markdown)
- **Purpose**: Human-readable guidelines for LLM semantic validation
- **Used By**: LLM for self-verification and content organization decisions
- **Example**:
  ```markdown
  ## Organization Guidelines

  1. Each note should focus on a single concept or paper
  2. Use descriptive filenames in format: `YYYY-MM-DD-topic-slug.md`
  3. Always include tags in frontmatter for categorization
  4. Link related notes using [[wikilinks]]
  5. Include a summary section at the top of each note
  ```

### Storage

KB metadata is persisted in:
```
.llm_bridges/knowledge_base/{name}/meta.md
```

With structure:
- **YAML Frontmatter**: `create_time`, `description`, `subfolder`
- **Body Content**: `organization_rules` text

---

## 3. Folder Constraint

A Folder Constraint defines machine-checkable metadata rules for notes under a specific subfolder.

### Purpose

- Enforce structured metadata requirements (硬規則)
- Automatically reject non-compliant write operations
- Provide clear, actionable error messages for violations

### Schema

```yaml
kb_name: string          # Name of the KB this constraint belongs to
subfolder: string        # Vault-relative path to the target folder
rules: ConstraintRules   # Structured metadata requirements
```

### Field Definitions

#### `kb_name`
- **Type**: String
- **Purpose**: Associates this constraint with a specific Knowledge Base
- **Constraint**: Must reference an existing KB

#### `subfolder`
- **Type**: String (vault-relative path)
- **Purpose**: Defines which notes this constraint applies to
- **Matching**: All notes whose path starts with this folder path must satisfy the constraint
- **Example**: `"research/ai/papers"` applies to all notes under that directory

#### `rules`
- **Type**: Structured object (see Rules Schema below)
- **Purpose**: Machine-checkable validation rules

### Rules Schema

The `rules` object can express:

```yaml
rules:
  frontmatter:
    required_fields:
      - name: string           # Field name
        type: string           # Data type: string|number|boolean|date|array
        pattern: regex         # Optional: regex pattern for validation
        allowed_values: array  # Optional: enumerated allowed values

  filename:
    pattern: regex             # Regex pattern for valid filenames

  content:
    min_length: number         # Minimum character count
    max_length: number         # Maximum character count
    required_sections: array   # Required heading sections
```

### Example Rules

```yaml
rules:
  frontmatter:
    required_fields:
      - name: title
        type: string
      - name: created_at
        type: date
        pattern: "^\\d{4}-\\d{2}-\\d{2}$"
      - name: status
        type: string
        allowed_values: ["draft", "review", "published"]
      - name: tags
        type: array

  filename:
    pattern: "^\\d{4}-\\d{2}-\\d{2}-[a-z0-9-]+\\.md$"
```

### Storage

Folder constraints are persisted under:
```
.llm_bridges/knowledge_base/{kb_name}/folder_constraints/
```

### Constraint Resolution

When validating a note at a given path:

1. Find all folder constraints where the note path starts with the constraint's `subfolder`
2. Apply the **most specific** constraint (longest `subfolder` prefix match)
3. If multiple constraints apply at the same specificity, all must pass

---

## 4. Note

A Note is a Markdown file in the Obsidian vault managed by a Knowledge Base.

### Properties

| Property | Description |
|----------|-------------|
| path | Vault-relative path to the note file |
| frontmatter | Optional YAML metadata block |
| content | Markdown body content |

### Structure

```markdown
---
title: "Example Note"
created_at: 2025-12-10
tags: [example, documentation]
---

# Note Content

Body content in Markdown format...
```

### Path Resolution

All note operations specify:
- `knowledge_base_name`: Which KB this note belongs to
- `note_path`: Path relative to KB's subfolder (or vault-relative, per server policy)

The system resolves the final path:
```
final_path = KB.subfolder + "/" + note_path
```

### Constraints

- All note operations MUST specify `knowledge_base_name`
- Note paths MUST resolve to locations under the KB's `subfolder`
- Notes are validated against applicable folder constraints before any write operation

---

## 5. Relationships

```
┌─────────────────────────────────────────────────────────┐
│                       Vault                             │
│  ┌───────────────────────────────────────────────────┐  │
│  │              Knowledge Base (KB)                  │  │
│  │  ┌─────────────┐    ┌────────────────────────┐   │  │
│  │  │ meta.md     │    │ Folder Constraints     │   │  │
│  │  │ - name      │    │ ┌────────────────────┐ │   │  │
│  │  │ - subfolder │    │ │ Constraint 1       │ │   │  │
│  │  │ - rules     │    │ │ - subfolder        │ │   │  │
│  │  └─────────────┘    │ │ - rules            │ │   │  │
│  │                     │ └────────────────────┘ │   │  │
│  │                     │ ┌────────────────────┐ │   │  │
│  │                     │ │ Constraint 2       │ │   │  │
│  │                     │ └────────────────────┘ │   │  │
│  │                     └────────────────────────┘   │  │
│  └───────────────────────────────────────────────────┘  │
│                            │                            │
│                            │ manages                    │
│                            ▼                            │
│  ┌───────────────────────────────────────────────────┐  │
│  │                 KB Subfolder                      │  │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐          │  │
│  │  │ Note 1  │  │ Note 2  │  │ Note 3  │  ...     │  │
│  │  └─────────┘  └─────────┘  └─────────┘          │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Cardinality

| Relationship | Cardinality |
|--------------|-------------|
| Vault : KB | 1 : N |
| KB : Folder Constraint | 1 : N |
| KB : Note (via subfolder) | 1 : N |
| Folder Constraint : Note | 1 : N (via path prefix matching) |
