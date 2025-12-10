# Storage Layout & Scope Rules

This document defines the file system structure and path scoping rules for the LLM Bridges system.

## Directory Structure

### Overview

```
vault_root/
│
├── .llm_bridges/                           # System management directory
│   └── knowledge_base/                     # KB configurations
│       ├── {kb_name_1}/
│       │   ├── meta.md                     # KB metadata
│       │   └── folder_constraints/         # Constraint definitions
│       │       ├── constraint_1.md
│       │       └── constraint_2.md
│       │
│       └── {kb_name_2}/
│           ├── meta.md
│           └── folder_constraints/
│               └── ...
│
├── {kb_subfolder_1}/                       # Notes managed by KB 1
│   ├── note_1.md
│   ├── note_2.md
│   └── subdirectory/
│       └── note_3.md
│
├── {kb_subfolder_2}/                       # Notes managed by KB 2
│   └── ...
│
└── ... (other vault content not managed by LLM Bridges)
```

---

## Management Directory (`.llm_bridges/`)

### Purpose

The `.llm_bridges/` directory at vault root contains all system configuration and metadata. This directory:

- **Is NOT for user notes** - only system metadata
- **Should be version controlled** (not gitignored)
- **Can be backed up** with the vault

### Structure

```
.llm_bridges/
└── knowledge_base/
    └── {kb_name}/
        ├── meta.md
        └── folder_constraints/
            └── *.md
```

---

## Knowledge Base Metadata (`meta.md`)

### Location

```
.llm_bridges/knowledge_base/{kb_name}/meta.md
```

### Format

```markdown
---
create_time: "2025-12-10T14:30:00Z"
description: "Knowledge base for AI research papers and notes"
subfolder: "research/ai"
---

## Organization Rules

1. Each note should focus on a single paper or concept
2. Use filename format: `YYYY-MM-DD-topic-slug.md`
3. Required frontmatter: title, authors, tags, status
4. Include abstract/summary at the beginning
5. Link related papers using [[wikilinks]]
6. Tag with relevant ML/AI domains

## File Naming Convention

- Papers: `YYYY-MM-DD-first-author-short-title.md`
- Concepts: `concept-name.md`
- Collections: `collection-topic.md`

## Folder Structure

- `/papers/` - Individual paper notes
- `/concepts/` - Standalone concept explanations
- `/collections/` - Curated topic collections
```

### Field Reference

| Location | Field | Type | Description |
|----------|-------|------|-------------|
| Frontmatter | `create_time` | ISO 8601 | KB creation timestamp |
| Frontmatter | `description` | String | Brief KB purpose description |
| Frontmatter | `subfolder` | String | Vault-relative path KB manages |
| Body | (free-form) | Markdown | `organization_rules` content |

---

## Folder Constraints Storage

### Location

```
.llm_bridges/knowledge_base/{kb_name}/folder_constraints/
```

### File Naming

Constraint files can use any naming convention. Recommended:

- `{sanitized_subfolder_name}.md` - Named after target folder
- `{semantic_name}.md` - Named after rule purpose

### Format

```markdown
---
subfolder: "research/ai/papers"
---

## Rules

```yaml
frontmatter:
  required_fields:
    - name: title
      type: string
    - name: authors
      type: array
    - name: published_date
      type: date
      pattern: "^\\d{4}-\\d{2}-\\d{2}$"
    - name: status
      type: string
      allowed_values: ["reading", "read", "summarized"]
    - name: tags
      type: array

filename:
  pattern: "^\\d{4}-\\d{2}-\\d{2}-[a-z0-9-]+\\.md$"
```
```

### Multiple Constraints

A KB can have multiple folder constraints for different subfolders:

```
.llm_bridges/knowledge_base/research/folder_constraints/
├── papers.md           # Rules for research/ai/papers/
├── concepts.md         # Rules for research/ai/concepts/
└── collections.md      # Rules for research/ai/collections/
```

---

## Scope Rules

### KB Subfolder Scope

Every KB has a `subfolder` that defines its management scope:

```yaml
# KB: "research"
subfolder: "research/ai"

# This KB can only operate on notes under:
# vault_root/research/ai/**
```

### Path Resolution

When a note operation specifies `note_path`, the system resolves the final path:

```
Final Path = KB.subfolder + "/" + note_path
```

**Examples:**

| KB Subfolder | note_path | Final Path |
|--------------|-----------|------------|
| `research/ai` | `papers/2025-12-10-gpt.md` | `research/ai/papers/2025-12-10-gpt.md` |
| `daily-notes` | `2025/12/10.md` | `daily-notes/2025/12/10.md` |
| `projects` | `alpha/readme.md` | `projects/alpha/readme.md` |

### Scope Enforcement

All note operations MUST resolve to paths within the KB's subfolder:

```
✓ Valid:   KB(subfolder="notes") + note_path="daily/today.md"
           → notes/daily/today.md (within scope)

✗ Invalid: KB(subfolder="notes") + note_path="../secrets/key.md"
           → Error: invalid_note_path (path traversal attempt)

✗ Invalid: KB(subfolder="notes") + note_path="/etc/passwd"
           → Error: invalid_note_path (absolute path)
```

### Path Validation Rules

1. **No Absolute Paths**: `note_path` must be relative
2. **No Parent Traversal**: Reject paths containing `..`
3. **Within Subfolder**: Final resolved path must start with KB's subfolder
4. **Valid Characters**: Only filesystem-safe characters allowed

---

## Overlapping Subfolders Policy

### Problem

If two KBs have overlapping subfolders, a note might "belong" to multiple KBs:

```yaml
KB "parent":
  subfolder: "research"

KB "child":
  subfolder: "research/ai"

# A note at research/ai/paper.md belongs to both KBs!
```

### Policy Options

#### Option A: Disallow Overlapping (Recommended)

The system rejects KB creation if subfolder overlaps with existing KB:

```
add_knowledge_base(
  name: "child",
  subfolder: "research/ai"  # Overlaps with KB "parent" at "research"
)
→ Error: subfolder_overlap
```

**Advantages:**
- Deterministic behavior
- No ambiguity about which rules apply
- Simpler constraint resolution

#### Option B: Allow with Precedence

Allow overlaps, apply most specific KB's constraints:

```
# Note at research/ai/paper.md
# → Use KB "child" constraints (more specific)
```

**Advantages:**
- More flexible organization
- Allows hierarchical KB structure

**Disadvantages:**
- More complex constraint resolution
- Potential for unexpected behavior

### Recommendation

This specification **recommends Option A** (disallow overlapping) for implementation simplicity and deterministic behavior.

---

## Constraint Resolution

### Finding Applicable Constraints

When validating a note at `path`:

1. List all folder constraints in the note's KB
2. Filter to constraints where `path` starts with constraint's `subfolder`
3. Select the **most specific** constraint (longest `subfolder` prefix)

### Example

```
KB: "research"
KB Subfolder: "research/ai"

Constraints:
- Constraint A: subfolder = "research/ai"           (root)
- Constraint B: subfolder = "research/ai/papers"    (specific)
- Constraint C: subfolder = "research/ai/concepts"  (specific)

Note path: "research/ai/papers/2025-12-10-gpt.md"

Resolution:
- Constraint A matches (prefix "research/ai")
- Constraint B matches (prefix "research/ai/papers") ← Most specific
- Constraint C does not match

→ Apply Constraint B
```

### Multiple Matches at Same Specificity

If multiple constraints have the same prefix length, **all must pass**:

```
Constraints at "research/ai/papers":
- Constraint B: requires frontmatter.title
- Constraint D: requires frontmatter.tags

Note must satisfy BOTH constraints.
```

---

## File System Considerations

### Safe Path Handling

Implementation MUST:

1. **Normalize paths** - Resolve `.` and remove duplicate slashes
2. **Reject traversal** - Block `..` sequences
3. **Validate characters** - Only allow safe filesystem characters
4. **Handle encoding** - Properly handle Unicode filenames

### Directory Creation

When writing notes, the system SHOULD:

1. Create intermediate directories if they don't exist
2. Use vault-appropriate permissions
3. Handle concurrent directory creation safely

### File Locking

For concurrent access safety, consider:

1. File-level locking during writes
2. Optimistic locking with version checks
3. Atomic write operations (write to temp, then rename)

---

## Example: Complete KB Setup

### Create KB

```
add_knowledge_base(
  name: "ai-research",
  description: "AI/ML research papers and concepts",
  subfolder: "research/ai",
  organization_rules: "..."
)
```

Creates:
```
.llm_bridges/knowledge_base/ai-research/
└── meta.md
```

### Add Folder Constraints

```
add_knowledge_base_folder_constraint(
  kb_name: "ai-research",
  subfolder: "research/ai/papers",
  rules: {...}
)
```

Creates:
```
.llm_bridges/knowledge_base/ai-research/
├── meta.md
└── folder_constraints/
    └── papers.md
```

### Create Notes

```
create_note(
  knowledge_base_name: "ai-research",
  note_path: "papers/2025-12-10-transformers.md",
  note_content: "..."
)
```

Creates:
```
research/ai/papers/2025-12-10-transformers.md
```

### Final Structure

```
vault_root/
├── .llm_bridges/
│   └── knowledge_base/
│       └── ai-research/
│           ├── meta.md
│           └── folder_constraints/
│               └── papers.md
│
└── research/
    └── ai/
        └── papers/
            └── 2025-12-10-transformers.md
```
