export const ORGANIZATION_HEADERS = [
  "CODIGO DO INTEGRANTE",
  "NOME DO INTEGRANTE",
  "PRODUTO",
  "FRENTE",
  "NOME DO TIME",
  "CARGO",
  "SENIORIDADE",
  "REGIME",
  "APTO PARA LEVANTADA",
  "ATIVO",
  "CODIGO DO LIDER",
  "NOME DO LIDER",
  "LIDER EM TREINAMENTO",
  "SUPERVISOR",
] as const;

export type OrganizationWarningCode =
  | "missing_person_code"
  | "missing_leader_code"
  | "unknown_leader"
  | "duplicate_person_code"
  | "conflicting_membership"
  | "conflicting_product"
  | "conflicting_role_signals"
  | "invalid_boolean"
  | "unmapped_organizational_role"
  | "malformed_row";

export const organizationalRoleKinds = [
  "closer",
  "sdr",
  "leader",
  "leader_in_training",
  "supervisor",
  "administrator",
] as const;
export type OrganizationalRoleKind = (typeof organizationalRoleKinds)[number];

export type OrganizationWarning = {
  code: OrganizationWarningCode;
  rowNumber: number;
  personCode: string | null;
  detail: string;
};

export type OrganizationPersonCandidate = {
  personCode: string;
  fullName: string;
  active: boolean;
  position: string | null;
  seniority: string | null;
  employmentType: string | null;
  canTakeLeads: boolean | null;
  leaderInTraining: boolean | null;
  supervisor: boolean | null;
  organizationalRole: OrganizationalRoleKind | null;
  productKey: string;
  frontKey: string;
  teamKey: string;
};

export type OrganizationMembershipCandidate = {
  personCode: string;
  productKey: string;
  frontKey: string;
  teamKey: string;
  validFrom: string;
};

export type OrganizationLeadershipCandidate = {
  leaderCode: string;
  teamKey: string;
  validFrom: string;
};

export type OrganizationCandidate = {
  accepted: boolean;
  rejectionReasons: string[];
  observedAt: string;
  rowCount: number;
  people: OrganizationPersonCandidate[];
  memberships: OrganizationMembershipCandidate[];
  leaderships: OrganizationLeadershipCandidate[];
  products: Array<{ key: string; displayName: string }>;
  fronts: Array<{ key: string; displayName: string }>;
  teams: Array<{ key: string; displayName: string; productKey: string; frontKey: string }>;
  warnings: OrganizationWarning[];
};

export type OrganizationCandidateAssessment = {
  publishable: boolean;
  reasons: string[];
};

export function safeOrganizationSyncError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return /^[a-z][a-z0-9_]{2,100}$/.test(message) ? message : "organization_sync_failed";
}

export function assessOrganizationCandidate(
  candidate: OrganizationCandidate,
  baseline: { currentActivePeople: number; maximumActiveDropFraction?: number },
): OrganizationCandidateAssessment {
  const reasons = [...candidate.rejectionReasons];
  const currentActivePeople = Math.max(0, Math.trunc(baseline.currentActivePeople));
  if (candidate.accepted && currentActivePeople > 0) {
    const candidateActivePeople = candidate.people.filter((person) => person.active).length;
    const dropFraction = Math.max(0, (currentActivePeople - candidateActivePeople) / currentActivePeople);
    const maximumDrop = baseline.maximumActiveDropFraction ?? 0.35;
    if (dropFraction > maximumDrop) reasons.push(`active_people_drop_exceeds_limit:${(dropFraction * 100).toFixed(1)}%`);
  }
  return { publishable: reasons.length === 0, reasons };
}

function comparable(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeOrganizationComparable(value: unknown): string {
  return comparable(value);
}

function code(value: unknown): string | null {
  const normalized = comparable(value).replace(/\s+/g, "");
  return /^V\d+$/.test(normalized) ? normalized : null;
}

function key(value: unknown): string {
  return comparable(value).toLowerCase().replace(/\s+/g, "-");
}

function parseBoolean(value: unknown): boolean | null | "invalid" {
  const normalized = comparable(value);
  if (!normalized) return null;
  if (["TRUE", "VERDADEIRO", "SIM", "1"].includes(normalized)) return true;
  if (["FALSE", "FALSO", "NAO", "0"].includes(normalized)) return false;
  return "invalid";
}

const sourceCargoRoles: Readonly<Record<string, "closer" | "sdr" | "administrator">> = {
  CLOSER: "closer",
  SDR: "sdr",
  ADMINISTRADOR: "administrator",
};

function deriveOrganizationalRole(input: {
  person: OrganizationPersonCandidate;
  isLeader: boolean;
  rowNumber: number;
  warnings: OrganizationWarning[];
}): OrganizationalRoleKind | null {
  const { person, isLeader, rowNumber, warnings } = input;
  if (person.supervisor === null || person.leaderInTraining === null) return null;
  if (person.supervisor && person.leaderInTraining) {
    warnings.push({
      code: "conflicting_role_signals",
      rowNumber,
      personCode: person.personCode,
      detail: "Supervisor and Leader in Training are both active; the previous role is preserved.",
    });
    return null;
  }
  if (person.supervisor) return "supervisor";
  if (person.leaderInTraining) return "leader_in_training";
  if (isLeader) return "leader";
  const role = sourceCargoRoles[comparable(person.position)];
  if (role) return role;
  warnings.push({
    code: "unmapped_organizational_role",
    rowNumber,
    personCode: person.personCode,
    detail: "Cargo does not map to an approved organizational role; the previous role is preserved.",
  });
  return null;
}

export function parseOrganizationSheet(input: { values: unknown[][]; observedAt: string }): OrganizationCandidate {
  const observedAt = new Date(input.observedAt).toISOString();
  const header = input.values[0] ?? [];
  const index = new Map(header.map((value, column) => [comparable(value), column]));
  const missingHeaders = ORGANIZATION_HEADERS.filter((name) => !index.has(name));
  const warnings: OrganizationWarning[] = [];
  const people: OrganizationPersonCandidate[] = [];
  const memberships: OrganizationMembershipCandidate[] = [];
  const leaderships: Array<OrganizationLeadershipCandidate & { sourceRowNumber: number; memberCode: string }> = [];
  const products = new Map<string, string>();
  const fronts = new Map<string, string>();
  const teams = new Map<string, { displayName: string; productKey: string; frontKey: string }>();
  const seenPeople = new Map<string, OrganizationPersonCandidate>();
  const sourceRowsByPersonCode = new Map<string, number>();
  const conflictingCodes = new Set<string>();

  const value = (row: unknown[], name: typeof ORGANIZATION_HEADERS[number]) => row[index.get(name) ?? -1];
  for (const [offset, row] of input.values.slice(1).entries()) {
    const rowNumber = offset + 2;
    if (!row.some((cell) => String(cell ?? "").trim())) continue;
    const personCode = code(value(row, "CODIGO DO INTEGRANTE"));
    if (!personCode) {
      warnings.push({ code: "missing_person_code", rowNumber, personCode: null, detail: "Canonical person code is missing or invalid." });
      continue;
    }
    const fullName = String(value(row, "NOME DO INTEGRANTE") ?? "").trim();
    const productDisplay = String(value(row, "PRODUTO") ?? "").trim();
    const frontDisplay = String(value(row, "FRENTE") ?? "").trim();
    const teamDisplay = String(value(row, "NOME DO TIME") ?? "").trim();
    if (!fullName || !productDisplay || !frontDisplay || !teamDisplay) {
      warnings.push({ code: "malformed_row", rowNumber, personCode, detail: "Name, product, front and team are required." });
      continue;
    }
    const productKey = key(productDisplay);
    const frontKey = key(frontDisplay);
    const teamKey = `${productKey}:${frontKey}:${key(teamDisplay)}`;
    const booleanFields = {
      canTakeLeads: parseBoolean(value(row, "APTO PARA LEVANTADA")),
      active: parseBoolean(value(row, "ATIVO")),
      leaderInTraining: parseBoolean(value(row, "LIDER EM TREINAMENTO")),
      supervisor: parseBoolean(value(row, "SUPERVISOR")),
    };
    for (const [field, parsed] of Object.entries(booleanFields)) {
      if (parsed === "invalid") warnings.push({ code: "invalid_boolean", rowNumber, personCode, detail: `${field} has an invalid boolean value.` });
    }
    if (booleanFields.active === "invalid") continue;
    const person: OrganizationPersonCandidate = {
      personCode,
      fullName,
      active: booleanFields.active ?? true,
      position: String(value(row, "CARGO") ?? "").trim() || null,
      seniority: String(value(row, "SENIORIDADE") ?? "").trim() || null,
      employmentType: String(value(row, "REGIME") ?? "").trim() || null,
      canTakeLeads: booleanFields.canTakeLeads === "invalid" ? null : booleanFields.canTakeLeads,
      leaderInTraining: booleanFields.leaderInTraining === "invalid" ? null : booleanFields.leaderInTraining ?? false,
      supervisor: booleanFields.supervisor === "invalid" ? null : booleanFields.supervisor ?? false,
      organizationalRole: null,
      productKey,
      frontKey,
      teamKey,
    };
    const previous = seenPeople.get(personCode);
    if (previous) {
      warnings.push({ code: "duplicate_person_code", rowNumber, personCode, detail: "The same canonical person code appears more than once." });
      if (previous.teamKey !== teamKey) {
        warnings.push({ code: "conflicting_membership", rowNumber, personCode, detail: "Duplicate person code points to different teams." });
        conflictingCodes.add(personCode);
      }
      if (previous.productKey !== productKey) {
        warnings.push({ code: "conflicting_product", rowNumber, personCode, detail: "Duplicate person code points to different products." });
        conflictingCodes.add(personCode);
      }
      continue;
    }
    seenPeople.set(personCode, person);
    sourceRowsByPersonCode.set(personCode, rowNumber);
    people.push(person);
    products.set(productKey, productDisplay);
    fronts.set(frontKey, frontDisplay);
    teams.set(teamKey, { displayName: teamDisplay, productKey, frontKey });
    if (person.active) memberships.push({ personCode, productKey, frontKey, teamKey, validFrom: observedAt });
    const leaderCode = code(value(row, "CODIGO DO LIDER"));
    if (person.active && leaderCode) leaderships.push({ leaderCode, teamKey, validFrom: observedAt, sourceRowNumber: rowNumber, memberCode: personCode });
    else if (person.active && !leaderCode && String(value(row, "NOME DO LIDER") ?? "").trim()) {
      warnings.push({ code: "missing_leader_code", rowNumber, personCode, detail: "Leader name is present without a canonical leader code." });
    }
  }

  const resolvedLeaderships = leaderships.filter((leadership) => {
    if (seenPeople.get(leadership.leaderCode)?.active) return true;
    warnings.push({
      code: "unknown_leader",
      rowNumber: leadership.sourceRowNumber,
      personCode: leadership.memberCode,
      detail: `Leader code ${leadership.leaderCode} does not resolve to a person in the candidate snapshot.`,
    });
    return false;
  });
  const leaderCodes = new Set(resolvedLeaderships.map((leadership) => leadership.leaderCode));
  for (const person of people) {
    if (!person.active) continue;
    person.organizationalRole = deriveOrganizationalRole({
      person,
      isLeader: leaderCodes.has(person.personCode),
      rowNumber: sourceRowsByPersonCode.get(person.personCode) ?? 0,
      warnings,
    });
  }

  return {
    accepted: missingHeaders.length === 0 && people.length > 0 && conflictingCodes.size === 0,
    rejectionReasons: [
      ...missingHeaders.map((name) => `missing_required_header:${name}`),
      ...(people.length === 0 ? ["unexpected_empty_snapshot"] : []),
      ...[...conflictingCodes].map((personCode) => `conflicting_duplicate_person_code:${personCode}`),
    ],
    observedAt,
    rowCount: input.values.slice(1).filter((row) => row.some((cell) => String(cell ?? "").trim())).length,
    people,
    memberships,
    leaderships: [...new Map(resolvedLeaderships.map((item) => [
      `${item.leaderCode}:${item.teamKey}`,
      { leaderCode: item.leaderCode, teamKey: item.teamKey, validFrom: item.validFrom },
    ])).values()],
    products: [...products].map(([productKey, displayName]) => ({ key: productKey, displayName })),
    fronts: [...fronts].map(([frontKey, displayName]) => ({ key: frontKey, displayName })),
    teams: [...teams].map(([teamKey, item]) => ({ key: teamKey, ...item })),
    warnings,
  };
}
