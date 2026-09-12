import assert from "node:assert/strict";
import test from "node:test";
import { assessOrganizationCandidate, parseOrganizationSheet, safeOrganizationSyncError } from "../src/organization.js";

const headers = [
  "Código do integrante",
  "Nome do integrante",
  "Produto",
  "Frente",
  "Nome do time",
  "Cargo",
  "Senioridade",
  "Regime",
  "Apto para levantada",
  "Ativo",
  "Código do líder",
  "Nome do líder",
  "Líder em treinamento",
  "Supervisor",
];

test("organization parser uses V-code identity and never invents a code", () => {
  const candidate = parseOrganizationSheet({
    observedAt: "2026-09-10T20:00:00.000Z",
    values: [
      headers,
      ["V1008", "Pessoa Sintética", "INSIDER", "CLOSERS", "Time Alpha", "Closer", "Pleno", "Fixo", "TRUE", "TRUE", "V063", "Líder Sintético", "FALSE", "FALSE"],
      ["", "Sem Código", "INSIDER", "CLOSERS", "Time Alpha", "Closer", "Júnior", "Fixo", "FALSE", "TRUE", "V063", "Líder Sintético", "FALSE", "FALSE"],
    ],
  });

  assert.equal(candidate.accepted, true);
  assert.equal(candidate.people.length, 1);
  assert.equal(candidate.people[0].personCode, "V1008");
  assert.equal(candidate.people[0].fullName, "Pessoa Sintética");
  assert.equal(candidate.people[0].organizationalRole, "closer");
  assert.equal(candidate.warnings.filter((warning) => warning.code === "missing_person_code").length, 1);
  assert.equal(candidate.memberships[0].validFrom, "2026-09-10T20:00:00.000Z");
});

test("organization Sheet cannot grant a system role", () => {
  const candidate = parseOrganizationSheet({
    observedAt: "2026-09-10T20:00:00.000Z",
    values: [
      [...headers, "System Role"],
      ["V1008", "Pessoa Sintética", "INSIDER", "CLOSERS", "Time Alpha", "Closer", "Pleno", "Fixo", "TRUE", "TRUE", "V1008", "Pessoa Sintética", "FALSE", "FALSE", "PLATFORM_ADMIN"],
    ],
  });
  assert.equal(candidate.accepted, true);
  assert.equal("role" in candidate.people[0], false);
  assert.equal("systemRole" in candidate.people[0], false);
  assert.equal(candidate.people[0].organizationalRole, "leader");
  assert.notEqual(candidate.people[0].organizationalRole, "PLATFORM_ADMIN");
});

test("organization sync errors expose only stable non-sensitive codes", () => {
  assert.equal(safeOrganizationSyncError(new Error("google_sheets_access_denied")), "google_sheets_access_denied");
  assert.equal(safeOrganizationSyncError(new Error("request failed for https://secret.invalid?token=value")), "organization_sync_failed");
});

test("organization parser rejects conflicting duplicate V-codes", () => {
  const candidate = parseOrganizationSheet({
    observedAt: "2026-09-10T20:00:00.000Z",
    values: [
      headers,
      ["V1008", "Pessoa Sintética", "INSIDER", "CLOSERS", "Time Alpha", "Closer", "Pleno", "Fixo", "TRUE", "TRUE", "V063", "Líder Sintético", "FALSE", "FALSE"],
      ["V1008", "Pessoa Sintética Renomeada", "FL", "CLOSERS", "Time Beta", "Closer", "Pleno", "Fixo", "TRUE", "TRUE", "V063", "Líder Sintético", "FALSE", "FALSE"],
    ],
  });

  assert.equal(candidate.accepted, false);
  assert.deepEqual(candidate.warnings.map((warning) => warning.code).filter((code) => code !== "unknown_leader"), [
    "duplicate_person_code",
    "conflicting_membership",
    "conflicting_product",
  ]);
  assert.ok(candidate.rejectionReasons.includes("conflicting_duplicate_person_code:V1008"));
});

test("organization parser resolves leaders only by code and reports unknown leaders", () => {
  const candidate = parseOrganizationSheet({
    observedAt: "2026-09-10T20:00:00.000Z",
    values: [
      headers,
      ["V063", "Líder Sintético", "INSIDER", "CLOSERS", "Time Alpha", "Líder", "Sênior", "Fixo", "TRUE", "TRUE", "V063", "Nome Divergente", "FALSE", "TRUE"],
      ["V1008", "Pessoa Sintética", "INSIDER", "CLOSERS", "Time Alpha", "Closer", "Pleno", "Fixo", "TRUE", "TRUE", "V063", "Outro Nome", "FALSE", "FALSE"],
      ["V1009", "Pessoa Sem Líder Resolvido", "INSIDER", "CLOSERS", "Time Beta", "Closer", "Júnior", "Fixo", "TRUE", "TRUE", "V999", "Desconhecido", "FALSE", "FALSE"],
    ],
  });

  assert.deepEqual(candidate.leaderships, [{
    leaderCode: "V063",
    teamKey: "insider:closers:time-alpha",
    validFrom: "2026-09-10T20:00:00.000Z",
  }]);
  assert.deepEqual(candidate.warnings.map((warning) => warning.code), ["unknown_leader"]);
});

test("inactive people cannot become current leaders or supervisors", () => {
  const candidate = parseOrganizationSheet({
    observedAt: "2026-09-10T20:00:00.000Z",
    values: [
      headers,
      ["V2000", "Pessoa Inativa", "INSIDER", "CLOSERS", "Time Alpha", "Líder", "Sênior", "Fixo", "TRUE", "FALSE", "V2000", "Pessoa Inativa", "FALSE", "TRUE"],
      ["V2001", "Pessoa Ativa", "INSIDER", "CLOSERS", "Time Alpha", "Closer", "Pleno", "Fixo", "TRUE", "TRUE", "V2000", "Pessoa Inativa", "FALSE", "FALSE"],
    ],
  });
  assert.equal(candidate.people.find((person) => person.personCode === "V2000")?.organizationalRole, null);
  assert.deepEqual(candidate.leaderships, []);
  assert.equal(candidate.warnings.some((warning) => warning.code === "unknown_leader"), true);
  assert.equal(candidate.warnings.some((warning) => warning.code === "missing_leader_code" && warning.personCode === "V2000"), false);
});

test("organization parser derives the approved cargo matrix with explicit precedence", () => {
  const candidate = parseOrganizationSheet({
    observedAt: "2026-09-10T20:00:00.000Z",
    values: [
      headers,
      ["V3000", "Líder Sintético", "INSIDER", "CLOSERS", "Time Alpha", "Closer", "Sênior", "Fixo", "TRUE", "TRUE", "V3000", "Líder Sintético", "FALSE", "FALSE"],
      ["V3001", "Closer Sintético", "INSIDER", "CLOSERS", "Time Alpha", "Closer", "Pleno", "Fixo", "TRUE", "TRUE", "V3000", "Líder Sintético", "FALSE", "FALSE"],
      ["V3002", "SDR Sintético", "INSIDER", "CLOSERS", "Time Alpha", "SDR", "Pleno", "Fixo", "TRUE", "TRUE", "V3000", "Líder Sintético", "FALSE", "FALSE"],
      ["V3003", "Treinamento Sintético", "INSIDER", "CLOSERS", "Time Alpha", "Closer", "Pleno", "Fixo", "TRUE", "TRUE", "V3000", "Líder Sintético", "TRUE", "FALSE"],
      ["V3004", "Supervisor Sintético", "INSIDER", "CLOSERS", "Time Alpha", "Closer", "Sênior", "Fixo", "TRUE", "TRUE", "V3000", "Líder Sintético", "FALSE", "TRUE"],
      ["V3005", "Administrador Sintético", "INSIDER", "CLOSERS", "Time Alpha", "Administrador", "Sênior", "Fixo", "TRUE", "TRUE", "V3000", "Líder Sintético", "FALSE", "FALSE"],
    ],
  });

  assert.deepEqual(Object.fromEntries(candidate.people.map((person) => [person.personCode, person.organizationalRole])), {
    V3000: "leader",
    V3001: "closer",
    V3002: "sdr",
    V3003: "leader_in_training",
    V3004: "supervisor",
    V3005: "administrator",
  });
});

test("organization candidate fails closed for missing headers, empty reads and mass disappearance", () => {
  const missingHeader = parseOrganizationSheet({
    observedAt: "2026-09-10T20:00:00.000Z",
    values: [["Código do integrante"], ["V1008"]],
  });
  assert.equal(assessOrganizationCandidate(missingHeader, { currentActivePeople: 10 }).publishable, false);

  const empty = parseOrganizationSheet({
    observedAt: "2026-09-10T20:00:00.000Z",
    values: [headers],
  });
  assert.deepEqual(assessOrganizationCandidate(empty, { currentActivePeople: 10 }), {
    publishable: false,
    reasons: ["unexpected_empty_snapshot"],
  });

  const onePerson = parseOrganizationSheet({
    observedAt: "2026-09-10T20:00:00.000Z",
    values: [
      headers,
      ["V1008", "Pessoa Sintética", "INSIDER", "CLOSERS", "Time Alpha", "Closer", "Pleno", "Fixo", "TRUE", "TRUE", "", "", "FALSE", "FALSE"],
    ],
  });
  assert.deepEqual(assessOrganizationCandidate(onePerson, { currentActivePeople: 10 }), {
    publishable: false,
    reasons: ["active_people_drop_exceeds_limit:90.0%"],
  });
});
