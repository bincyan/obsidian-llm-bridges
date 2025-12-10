# Agent Responsibilities

This document defines the behavioral requirements and responsibilities for LLM agents using the LLM Bridges system.

## Overview

The LLM Bridges system is designed as a **collaborative** system between machine enforcement (folder constraints) and LLM self-validation (organization rules). For safe and consistent operation, agents MUST follow specific behavioral rules.

---

## Core Responsibilities

### 1. Knowledge Base Setup

After calling `add_knowledge_base`, the agent MUST:

1. **Review** the returned KB's `subfolder` and `organization_rules`
2. **Design** appropriate folder constraints based on the KB's purpose
3. **Call** `add_knowledge_base_folder_constraint` to define machine-checkable rules
4. **Document** the constraint design rationale (if applicable)

#### Recommended Flow

```
1. add_knowledge_base(...)
   ↓
2. Analyze KB purpose and organization_rules
   ↓
3. Identify structured metadata requirements
   - Required frontmatter fields
   - Filename patterns
   - Content structure
   ↓
4. add_knowledge_base_folder_constraint(...)
   - One or more constraints for different subfolders
   ↓
5. Ready for note operations
```

#### Example

```
User: "Create a KB for my research papers"

Agent:
1. Call add_knowledge_base with appropriate organization_rules
2. Analyze: Papers need title, authors, date, tags
3. Call add_knowledge_base_folder_constraint with rules:
   - frontmatter: title (string), authors (array), date (date), tags (array)
   - filename: date-prefixed pattern
```

---

### 2. Note Operation Validation

For every note modification (`create_note`, `update_note`, `append_note`), the agent MUST:

#### Step 1: Check Machine Validation Result

```yaml
machine_validation:
  passed: true/false
  issues: [...]
```

- **If `passed: false`**: The operation was REJECTED. No file was written.
  - Read the `issues` array carefully
  - Correct the note content to satisfy all rules
  - Retry the operation with fixed content

#### Step 2: Perform Semantic Validation

Even if machine validation passes, the agent MUST:

1. **Read** the KB's `organization_rules` from the response
2. **Compare** the note content against these rules
3. **Assess** compliance with semantic guidelines

#### Step 3: Fix Issues (if any)

If the note does not comply with `organization_rules`:

1. **Identify** specific violations
2. **Call** `update_note` with corrected content
3. **Repeat** validation cycle

#### Decision Tree

```
┌─────────────────────────────────────────────────┐
│         Note Operation Response                 │
└─────────────────────┬───────────────────────────┘
                      │
                      ▼
            ┌─────────────────┐
            │ machine_validation │
            │    .passed?        │
            └────────┬──────────┘
                     │
         ┌───────────┴───────────┐
         │                       │
         ▼ false                 ▼ true
┌─────────────────┐    ┌─────────────────────────┐
│ Read .issues    │    │ Read organization_rules │
│ Fix content     │    │ Compare note content    │
│ Retry operation │    └───────────┬─────────────┘
└─────────────────┘                │
                                   ▼
                         ┌─────────────────┐
                         │ Compliant with  │
                         │ org rules?      │
                         └────────┬────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    │                           │
                    ▼ No                        ▼ Yes
          ┌─────────────────┐         ┌─────────────────┐
          │ Call update_note │         │ Operation       │
          │ with fixes       │         │ Complete        │
          └─────────────────┘         └─────────────────┘
```

---

### 3. Update Operations: Diff Verification

For `update_note` and `append_note`, the response includes both original and updated content.

The agent MUST:

1. **Compare** `original_note.content` with `updated_note.content`
2. **Verify** no important information was lost
3. **Check** all intended changes were applied correctly

#### Information Preservation Checklist

- [ ] All original data points preserved (unless intentionally removed)
- [ ] All links and references intact
- [ ] Frontmatter fields preserved (unless intentionally changed)
- [ ] No accidental content truncation

#### If Information Loss Detected

```
1. Identify what was lost
2. Reconstruct correct content (original + intended changes)
3. Call update_note with corrected content
```

---

### 4. Chunked Reading

When `read_note` returns `has_more: true`:

```yaml
note:
  content: "..."
  has_more: true
  next_offset: 10000
  remaining_chars: 15000
```

The agent SHOULD:

1. **Assess** if more context is needed for the current task
2. If yes: Call `read_note` again with `offset: next_offset`
3. **Continue** until sufficient context is gathered or `has_more: false`

#### Pagination Loop

```python
offset = 0
full_content = ""

while True:
    response = read_note(kb_name, path, offset=offset)
    full_content += response.note.content

    if not response.note.has_more:
        break

    offset = response.note.next_offset
```

---

### 5. Error Handling

#### `note_not_found`

When receiving this error:

- **Assess** if the note should exist
- If yes: Check path spelling, KB name
- If creating: Use `create_note` instead

#### `note_already_exists`

When receiving this error:

- **Decide** based on intent:
  - To replace: Use `update_note`
  - To add content: Use `append_note`
  - To abort: Inform user

#### `folder_constraint_violation`

When receiving this error:

1. **Read** the `issues` array completely
2. **For each issue**:
   - Identify the problematic field/value
   - Determine correct value based on constraint
3. **Fix** all issues in the note content
4. **Retry** the operation

#### Example Error Response

```json
{
  "error": {
    "code": "folder_constraint_violation",
    "issues": [
      {
        "field": "frontmatter.status",
        "error": "invalid_value",
        "expected": ["draft", "review", "published"],
        "actual": "pending"
      },
      {
        "field": "frontmatter.created_at",
        "error": "missing_required_field"
      }
    ]
  }
}
```

**Agent Action:**
```markdown
Fix 1: Change status from "pending" to "draft"
Fix 2: Add created_at field with valid date

Retry create_note with fixed content.
```

---

## Behavioral Rules Summary

### MUST DO

| Requirement | When |
|-------------|------|
| Define folder constraints | After `add_knowledge_base` |
| Check `machine_validation.passed` | Every note modification |
| Read `organization_rules` | Every note modification |
| Compare original vs updated | Every `update_note`/`append_note` |
| Fix constraint violations | When `folder_constraint_violation` error |
| Call `update_note` for semantic issues | When note doesn't match organization_rules |

### MUST NOT

| Prohibition | Reason |
|-------------|--------|
| Skip validation response | May leave non-compliant notes |
| Ignore machine validation errors | Operation was rejected, need to retry |
| Assume update preserved data | Must verify no information lost |
| Operate outside KB scope | Will get `invalid_note_path` error |
| Skip chunked reading | May miss important context |

---

## Validation Instruction Templates

The system provides `validation_instruction_for_llm` in responses. These are templates the agent should follow:

### For `create_note`

```
Please verify the note against the knowledge base's organization_rules:

1. Check that the note content follows the organization guidelines
2. Ensure the note structure matches KB conventions
3. Verify all recommended metadata is present

If any issues are found, call update_note with corrected content.
```

### For `update_note`

```
Please verify the update against the knowledge base's organization_rules:

1. Compare original and updated content to ensure no important information was lost
2. Check that the updated note follows the organization guidelines
3. Verify the note structure matches KB conventions
4. Ensure all links and references are intact

If any issues are found, call update_note again with corrected content.
```

### For `append_note`

```
Please verify the append operation against the knowledge base's organization_rules:

1. Check that the combined content makes logical sense
2. Verify the appended content integrates well with existing content
3. Ensure no duplicate information was introduced
4. Check that overall note structure remains compliant

If any issues are found, call update_note with corrected content.
```

---

## Best Practices

### Knowledge Base Design

1. **Start with clear organization_rules** - Well-written rules make LLM validation easier
2. **Define constraints incrementally** - Start simple, add complexity as needed
3. **Document constraint rationale** - Explain *why* each rule exists
4. **Test constraints** - Verify rules work before heavy usage

### Note Operations

1. **Validate proactively** - Check constraints before writing
2. **Use descriptive filenames** - Follow KB naming conventions
3. **Include complete frontmatter** - Satisfy all required fields
4. **Preserve context** - Don't truncate or lose information

### Error Recovery

1. **Read error details completely** - Don't assume the issue
2. **Fix all issues at once** - Avoid multiple retry loops
3. **Verify fix before retry** - Ensure all constraints are satisfied
4. **Ask user when uncertain** - Don't guess at ambiguous rules

---

## Example: Complete Agent Workflow

```
User: "Create a note about transformer architecture in my AI research KB"

Agent:
1. Call list_knowledge_bases to find "ai-research" KB
   → Found: subfolder="research/ai", has folder constraints for "research/ai/papers"

2. Review folder constraints:
   → Required: title, authors, date, status, tags
   → Filename pattern: date-prefixed

3. Prepare note content:
   ---
   title: "Transformer Architecture"
   authors: ["Vaswani et al."]
   published_date: "2017-06-12"
   status: "summarized"
   tags: ["attention", "nlp", "architecture"]
   ---
   # Transformer Architecture
   ...

4. Call create_note(
     knowledge_base_name="ai-research",
     note_path="papers/2025-12-10-transformer-architecture.md",
     note_content="..."
   )

5. Check response:
   → machine_validation.passed = true
   → Read organization_rules: "Include summary at top, link related papers..."

6. Semantic validation:
   → Note has summary section? Yes
   → Related papers linked? No - missing [[attention-is-all-you-need]]

7. Call update_note with added wikilink

8. Verify update:
   → Original preserved? Yes
   → Link added? Yes
   → Machine validation passed? Yes

9. Operation complete
```
