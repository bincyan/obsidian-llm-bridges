/**
 * Shared types for LLM Bridges - Knowledge Base System
 * Based on spec/01-core-concepts.md
 */

// ============================================================================
// Knowledge Base Types
// ============================================================================

export interface KnowledgeBase {
  name: string;
  create_time: string; // ISO 8601
  description: string;
  subfolder: string;
  organization_rules: string;
}

export interface KnowledgeBaseSummary {
  name: string;
  description: string;
  subfolder: string;
  create_time: string;
  organization_rules_preview?: string;
}

// ============================================================================
// Folder Constraint Types
// ============================================================================

export interface FolderConstraint {
  kb_name: string;
  subfolder: string;
  rules: ConstraintRules;
}

export interface ConstraintRules {
  frontmatter?: FrontmatterRules;
  filename?: FilenameRules;
  content?: ContentRules;
}

export interface FrontmatterRules {
  required_fields?: RequiredField[];
}

export interface RequiredField {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'array';
  pattern?: string; // Regex pattern
  allowed_values?: (string | number | boolean)[];
}

export interface FilenameRules {
  pattern?: string; // Regex pattern
}

export interface ContentRules {
  min_length?: number;
  max_length?: number;
  required_sections?: string[];
}

// ============================================================================
// Validation Types
// ============================================================================

export interface ValidationResult {
  passed: boolean;
  issues: ValidationIssue[];
}

export interface ValidationDetails {
  kb_rules: string;
  issues: ValidationIssue[];
  folder_constraint?: FolderConstraint;
}

export interface ValidationIssue {
  field: string;
  error: ValidationErrorType;
  expected?: unknown;
  actual?: unknown;
  pattern?: string;
  message?: string;
}

export type ValidationErrorType =
  | 'missing_required_field'
  | 'invalid_field_type'
  | 'invalid_value'
  | 'pattern_mismatch'
  | 'content_too_short'
  | 'content_too_long'
  | 'missing_section';

// ============================================================================
// Note Types
// ============================================================================

export interface NoteInfo {
  path: string;
  content: string;
}

export interface NoteReadResult {
  path: string;
  content: string;
  offset: number;
  next_offset: number;
  has_more: boolean;
  remaining_chars: number;
}

export interface ParsedNote {
  frontmatter: Record<string, unknown>;
  body: string;
  raw: string;
}

// ============================================================================
// Error Types
// ============================================================================

export type ErrorCode =
  | 'knowledge_base_not_found'
  | 'knowledge_base_already_exists'
  | 'folder_constraint_violation'
  | 'note_not_found'
  | 'note_already_exists'
  | 'invalid_note_path'
  | 'schema_validation_failed'
  | 'subfolder_overlap'
  | 'version_conflict';

export interface ApiError {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

export interface ConstraintViolationError extends ApiError {
  code: 'folder_constraint_violation';
  constraint: {
    kb_name: string;
    subfolder: string;
  };
  issues: ValidationIssue[];
}

// ============================================================================
// API Response Types
// ============================================================================

export interface ListKnowledgeBasesResponse {
  knowledge_bases: KnowledgeBaseSummary[];
}

export interface AddKnowledgeBaseResponse {
  knowledge_base: KnowledgeBase;
  next_steps: string;
}

export interface UpdateKnowledgeBaseResponse {
  knowledge_base: KnowledgeBase;
  notes?: string[];
}

export interface AddFolderConstraintResponse {
  folder_constraint: FolderConstraint;
}

export interface CreateNoteResponse {
  knowledge_base: KnowledgeBase;
  note: NoteInfo;
  validation: ValidationDetails;
  validation_instruction_for_llm: string;
}

export interface UpdateNoteResponse {
  knowledge_base: KnowledgeBase;
  original_note: NoteInfo;
  updated_note: NoteInfo;
  validation: ValidationDetails;
  validation_instruction_for_llm: string;
}

export interface MoveNoteResponse {
  knowledge_base: KnowledgeBase;
  origin_path: string;
  new_path: string;
  validation: ValidationDetails;
  validation_instruction_for_llm?: string;
}

export interface DeleteNoteResponse {
  knowledge_base: {
    name: string;
    subfolder: string;
  };
  deleted_path: string;
}

export interface ReadNoteResponse {
  knowledge_base: KnowledgeBase;
  note: NoteReadResult;
}

export interface ListNotesResponse {
  knowledge_base: {
    name: string;
    subfolder: string;
  };
  notes: { path: string }[];
}

// ============================================================================
// Validation Instruction Templates
// ============================================================================

export const VALIDATION_INSTRUCTIONS = {
  create_note: `Please check your note MUST following rules:

{{kb_rules}}

If any issues are found, call update_note with corrected content.`,

  update_note: `Please check your note MUST following rules:

{{kb_rules}}

If any issues are found, call update_note again with corrected content.`,

  append_note: `Please check your note MUST following rules:

{{kb_rules}}

If any issues are found, call update_note with corrected content.`,

  move_note: `Please check your note MUST following rules:

{{kb_rules}}

If any issues are found, call update_note with corrected content.`,
};

// ============================================================================
// Constants
// ============================================================================

export const LLM_BRIDGES_DIR = '.llm_bridges';
export const KNOWLEDGE_BASE_DIR = 'knowledge_base';
export const FOLDER_CONSTRAINTS_DIR = 'folder_constraints';
export const META_FILE = 'meta.md';

export const DEFAULT_READ_LIMIT = 10000;
