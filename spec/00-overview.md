# LLM Bridges for Obsidian - System Overview

## Purpose

This system is an MCP-based bridge between LLM agents and an Obsidian vault, providing a structured, rule-driven way for LLMs to create, update, and organize notes through **Knowledge Bases (KBs)**.

## Design Goals

1. **Structured Knowledge Management**: Organize vault content through logical Knowledge Bases
2. **Rule-Driven Operations**: Enforce both machine-checkable and semantic rules for note organization
3. **LLM-Safe Operations**: All note operations are scoped to specific KBs, preventing uncontrolled vault modifications
4. **Two-Layer Validation**: Combine machine validation (hard rules) with LLM semantic validation (soft rules)

## Key Concepts

### Knowledge Base (KB)

A Knowledge Base is the central organizational unit that defines:
- **Subfolder Scope**: The vault directory it manages
- **Organization Rules**: Human-readable guidelines for LLM self-validation (自然語言整理準則)
- **Folder Constraints**: Machine-checkable metadata rules for notes under specific paths

### Validation Model

Every note operation goes through two validation layers:

1. **Machine Validation** (硬規則)
   - Enforced by Folder Constraints
   - Non-compliant writes are rejected
   - Returns structured error details

2. **Semantic Validation** (軟規則)
   - Guided by `organization_rules`
   - LLM performs self-verification
   - Non-compliant notes trigger update requests

### Operation Flow

```
┌─────────────────┐
│  LLM Agent      │
└────────┬────────┘
         │ MCP Tool Call
         ▼
┌─────────────────┐
│  MCP Server     │
│  (LLM Bridges)  │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  Validation Layer                   │
│  ┌─────────────┐  ┌──────────────┐  │
│  │ Folder      │  │ Organization │  │
│  │ Constraints │  │ Rules        │  │
│  │ (Machine)   │  │ (Semantic)   │  │
│  └──────┬──────┘  └──────┬───────┘  │
│         │                │          │
│    Hard Reject     LLM Self-Check   │
└─────────┴────────────────┴──────────┘
         │
         ▼
┌─────────────────┐
│  Obsidian Vault │
│  (File System)  │
└─────────────────┘
```

## System Architecture

### Components

| Component | Role |
|-----------|------|
| MCP Server | Handles tool calls from LLM agents |
| Knowledge Base Manager | CRUD operations for KBs and constraints |
| Note Manager | Note operations with validation |
| Validation Engine | Applies folder constraints and returns validation results |
| Storage Layer | Persists KB metadata and note files |

### Storage Layout

```
vault_root/
├── .llm_bridges/                    # Management directory
│   └── knowledge_base/
│       └── {kb_name}/
│           ├── meta.md              # KB metadata & organization_rules
│           └── folder_constraints/  # Constraint definitions
│               └── *.md
│
├── {kb_subfolder}/                  # KB-managed notes
│   └── ...
│
└── ... (other vault content)
```

## Document Index

| Document | Content |
|----------|---------|
| [01-core-concepts.md](./01-core-concepts.md) | Detailed entity definitions |
| [02-validation-model.md](./02-validation-model.md) | Validation rules and behavior |
| [03-storage-layout.md](./03-storage-layout.md) | File structure and scope rules |
| [04-mcp-tools.md](./04-mcp-tools.md) | Complete MCP tool specifications |
| [05-agent-responsibilities.md](./05-agent-responsibilities.md) | Agent behavioral requirements |

## Version

- **Spec Version**: 1.0.0
- **Last Updated**: 2025-12-10
