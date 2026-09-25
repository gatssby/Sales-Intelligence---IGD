import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { CALL_PILOT_DECISION_KEYS, CALL_PILOT_QUESTIONS, type PilotDecisionKey } from "@igd/decision-engine";

export const HUMAN_LABEL_CONTRACT_VERSION = "system-one-human-labels-v0.1";
export const DOUBLE_REVIEW_TEMPLATE_VERSION = "system-one-double-review-template-v0.1";
export const PILOT_BLIND_TEMPLATE_VERSION = "system-one-pilot-human-label-template-v0.2";
export const OBJECTION_TYPES = Object.freeze(Object.keys(CALL_PILOT_QUESTIONS.objection_type.criteria));
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BOOLEAN_KEYS = new Set<PilotDecisionKey>(CALL_PILOT_DECISION_KEYS.filter((key) => CALL_PILOT_QUESTIONS[key].type === "noul"));

export type HumanLabelValue = boolean | string | number | null;
export type HumanLabelEntry = {
  call_id: string;
  decision_key: PilotDecisionKey;
  human_value: HumanLabelValue;
  reviewer: string | null;
  reviewed_at: string | null;
  notes: string | null;
};
export type HumanLabelFile = {
  version: typeof HUMAN_LABEL_CONTRACT_VERSION | typeof DOUBLE_REVIEW_TEMPLATE_VERSION | typeof PILOT_BLIND_TEMPLATE_VERSION;
  entries: HumanLabelEntry[];
};
export type BlindReviewAnswer = { decisionKey: PilotDecisionKey; humanValue: HumanLabelValue; notes: string | null };
export type TablePrivileges = { select: boolean; insert: boolean; update: boolean; delete: boolean; truncate: boolean; references: boolean; trigger: boolean };
export type HumanReviewDatabaseSafety = {
  role: string;
  defaultTransactionReadOnly: string;
  transactionReadOnly: string;
  dangerousRoleAttributes: boolean;
  inheritedWritableRoles: string[];
  writableSchemas: string[];
  writableRelations: string[];
  writableColumns: string[];
  transcriptReadableColumns: string[];
  callsPrivileges: TablePrivileges;
  transcriptsPrivileges: TablePrivileges;
};

export const HUMAN_LABEL_RUBRIC = CALL_PILOT_DECISION_KEYS.map((key) => {
  const question = CALL_PILOT_QUESTIONS[key];
  return {
    key,
    type: question.type,
    instructions: question.instructions,
    options: question.type === "choice" ? Object.entries(question.criteria).map(([value, label]) => ({ value, label })) : question.type === "score" ? [1, 2, 3, 4, 5] : [true, false],
    nullable: true,
  };
});

function requireCallIds(callIds: string[]): void {
  if (!Array.isArray(callIds) || callIds.length < 1 || callIds.some((id) => !UUID_PATTERN.test(id)) || new Set(callIds).size !== callIds.length) {
    throw new Error("human_label_call_ids_invalid");
  }
}

function blankEntries(callIds: string[]): HumanLabelEntry[] {
  requireCallIds(callIds);
  return callIds.flatMap((callId) => CALL_PILOT_DECISION_KEYS.map((decisionKey) => ({
    call_id: callId,
    decision_key: decisionKey,
    human_value: null,
    reviewer: null,
    reviewed_at: null,
    notes: null,
  })));
}

export function createBlindLabelFile(callIds: string[]): HumanLabelFile {
  return { version: HUMAN_LABEL_CONTRACT_VERSION, entries: blankEntries(callIds) };
}

export function selectDoubleReviewCallIds(callIds: string[], count = 5): string[] {
  requireCallIds(callIds);
  if (!Number.isInteger(count) || count < 1 || count > callIds.length) throw new Error("double_review_count_invalid");
  if (count === 1) return [callIds[0]!];
  return Array.from({ length: count }, (_, index) => callIds[Math.round(index * (callIds.length - 1) / (count - 1))]!);
}

export function createDoubleReviewTemplate(callIds: string[]): HumanLabelFile {
  return { version: DOUBLE_REVIEW_TEMPLATE_VERSION, entries: blankEntries(selectDoubleReviewCallIds(callIds)) };
}

export function validateHumanLabelValue(decisionKey: PilotDecisionKey, value: HumanLabelValue): void {
  if (value === null) return;
  if (BOOLEAN_KEYS.has(decisionKey)) {
    if (typeof value !== "boolean") throw new Error(`human_label_value_invalid:${decisionKey}`);
    return;
  }
  if (decisionKey === "objection_type") {
    if (typeof value !== "string" || !OBJECTION_TYPES.includes(value)) throw new Error(`human_label_value_invalid:${decisionKey}`);
    return;
  }
  if (decisionKey === "buyer_intent") {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 1 || value > 5) throw new Error(`human_label_value_invalid:${decisionKey}`);
    return;
  }
  throw new Error(`human_label_key_invalid:${decisionKey}`);
}

function parseEntry(value: unknown): HumanLabelEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("human_label_entry_invalid");
  const entry = value as Record<string, unknown>;
  const keys = Object.keys(entry).sort();
  if (JSON.stringify(keys) !== JSON.stringify(["call_id", "decision_key", "human_value", "notes", "reviewed_at", "reviewer"].sort())) throw new Error("human_label_entry_shape_invalid");
  if (typeof entry.call_id !== "string" || !UUID_PATTERN.test(entry.call_id)) throw new Error("human_label_call_id_invalid");
  if (typeof entry.decision_key !== "string" || !CALL_PILOT_DECISION_KEYS.includes(entry.decision_key as PilotDecisionKey)) throw new Error("human_label_decision_key_invalid");
  const decisionKey = entry.decision_key as PilotDecisionKey;
  validateHumanLabelValue(decisionKey, entry.human_value as HumanLabelValue);
  if (entry.reviewer !== null && (typeof entry.reviewer !== "string" || !entry.reviewer.trim() || entry.reviewer.length > 100)) throw new Error("human_label_reviewer_invalid");
  if (entry.reviewed_at !== null && (typeof entry.reviewed_at !== "string" || Number.isNaN(Date.parse(entry.reviewed_at)))) throw new Error("human_label_reviewed_at_invalid");
  if ((entry.reviewer === null) !== (entry.reviewed_at === null)) throw new Error("human_label_review_state_invalid");
  if (entry.notes !== null && (typeof entry.notes !== "string" || entry.notes.length > 2000)) throw new Error("human_label_notes_invalid");
  return entry as HumanLabelEntry;
}

export function parseHumanLabelFile(text: string): HumanLabelFile {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("human_labels_invalid_json"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("human_labels_invalid_shape");
  const candidate = value as Record<string, unknown>;
  if (!Object.keys(candidate).every((key) => ["version", "entries"].includes(key)) || ![HUMAN_LABEL_CONTRACT_VERSION, DOUBLE_REVIEW_TEMPLATE_VERSION, PILOT_BLIND_TEMPLATE_VERSION].includes(candidate.version as typeof HUMAN_LABEL_CONTRACT_VERSION) || !Array.isArray(candidate.entries)) {
    throw new Error("human_labels_invalid_shape");
  }
  const entries = candidate.entries.map(parseEntry);
  const identities = entries.map((entry) => `${entry.call_id}:${entry.decision_key}`);
  if (new Set(identities).size !== identities.length) throw new Error("human_labels_duplicate_entry");
  const perCall = new Map<string, Set<string>>();
  for (const entry of entries) perCall.set(entry.call_id, new Set([...(perCall.get(entry.call_id) ?? []), entry.decision_key]));
  if ([...perCall.values()].some((keys) => keys.size !== CALL_PILOT_DECISION_KEYS.length)) throw new Error("human_labels_incomplete_call_contract");
  return { version: candidate.version as HumanLabelFile["version"], entries };
}

export function applyBlindReviewSubmission(file: HumanLabelFile, input: { callId: string; reviewer: string; reviewedAt: string; answers: BlindReviewAnswer[] }): HumanLabelFile {
  if (!UUID_PATTERN.test(input.callId) || !input.reviewer.trim() || input.reviewer.length > 100 || Number.isNaN(Date.parse(input.reviewedAt))) throw new Error("human_review_submission_invalid");
  if (input.answers.length !== CALL_PILOT_DECISION_KEYS.length || new Set(input.answers.map((answer) => answer.decisionKey)).size !== CALL_PILOT_DECISION_KEYS.length) throw new Error("human_review_answers_incomplete");
  for (const key of CALL_PILOT_DECISION_KEYS) if (!input.answers.some((answer) => answer.decisionKey === key)) throw new Error("human_review_answers_incomplete");
  const answerByKey = new Map(input.answers.map((answer) => [answer.decisionKey, answer]));
  for (const answer of input.answers) {
    validateHumanLabelValue(answer.decisionKey, answer.humanValue);
    if (answer.notes !== null && (typeof answer.notes !== "string" || answer.notes.length > 2000)) throw new Error("human_label_notes_invalid");
  }
  let found = 0;
  const entries = file.entries.map((entry) => {
    if (entry.call_id !== input.callId) return entry;
    found += 1;
    const answer = answerByKey.get(entry.decision_key)!;
    return { ...entry, human_value: answer.humanValue, reviewer: input.reviewer.trim(), reviewed_at: input.reviewedAt, notes: answer.notes };
  });
  if (found !== CALL_PILOT_DECISION_KEYS.length) throw new Error("human_review_call_not_found");
  return { ...file, entries };
}

export function buildBlindReviewSession(file: HumanLabelFile) {
  const callIds = [...new Set(file.entries.map((entry) => entry.call_id))];
  const completedCalls = callIds.filter((callId) => file.entries.filter((entry) => entry.call_id === callId).every((entry) => entry.reviewed_at !== null)).length;
  return { contractVersion: file.version, callCount: callIds.length, completedCalls, questions: HUMAN_LABEL_RUBRIC };
}

export function validateHumanReviewDatabaseUrl(databaseUrl: string): URL {
  let parsed: URL;
  try { parsed = new URL(databaseUrl); } catch { throw new Error("human_review_database_url_invalid"); }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  if (!new Set(["127.0.0.1", "localhost", "::1"]).has(hostname) || parsed.port !== "5433") throw new Error("human_review_database_must_use_loopback_tunnel");
  return parsed;
}

export function resolvePrivateSystemOnePath(candidate: string, options: { root?: string; mustExist: boolean }): string {
  const rootInput = options.root ?? resolve("private/system-one");
  let root: string;
  try { root = realpathSync(rootInput); } catch { throw new Error("private_path_invalid"); }
  const repositoryRelative = candidate === "private/system-one" || candidate.startsWith("private/system-one/");
  const target = resolve(isAbsolute(candidate) || repositoryRelative ? candidate : resolve(root, candidate));
  const withinRoot = relative(root, target);
  if (withinRoot.startsWith("..") || isAbsolute(withinRoot)) throw new Error("private_path_outside_root");
  try {
    if (options.mustExist) {
      if (lstatSync(target).isSymbolicLink() || realpathSync(target) !== target) throw new Error("private_path_invalid");
    } else {
      const parent = resolve(target, "..");
      if (realpathSync(parent) !== parent || lstatSync(parent).isSymbolicLink()) throw new Error("private_path_invalid");
      try { if (lstatSync(target).isSymbolicLink()) throw new Error("private_path_invalid"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
  } catch (error) {
    if (error instanceof Error && error.message === "private_path_invalid") throw error;
    throw new Error("private_path_invalid");
  }
  return target;
}

export function validateHumanReviewDatabaseSafety(value: HumanReviewDatabaseSafety): void {
  const writePrivilege = (privileges: TablePrivileges) => privileges.insert || privileges.update || privileges.delete || privileges.truncate || privileges.references || privileges.trigger;
  const requiredTranscriptColumns = ["call_id", "created_at", "id", "normalized_text", "version"];
  const transcriptColumnsValid = requiredTranscriptColumns.every((column) => value.transcriptReadableColumns.includes(column));
  if (value.role !== "system_one_pilot_ro" || value.defaultTransactionReadOnly !== "on" || value.transactionReadOnly !== "on" || value.dangerousRoleAttributes || value.inheritedWritableRoles.length > 0 || value.writableSchemas.length > 0 || value.writableRelations.length > 0 || value.writableColumns.length > 0 || !transcriptColumnsValid || writePrivilege(value.callsPrivileges) || writePrivilege(value.transcriptsPrivileges)) {
    throw new Error("human_review_database_role_not_read_only");
  }
}

export function isLoopbackRemoteAddress(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

export const HUMAN_REVIEW_TRANSCRIPT_SQL = `
  select normalized_text transcript
  from public.transcripts
  where call_id = $1::uuid
  order by version desc, created_at desc, id desc
  limit 1
`;
