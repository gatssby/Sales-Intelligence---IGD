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
  assert.equal(candidate.warnings.filter((warning) => warning.code === "missing_person_code").length, 1);
  assert.equal(candidate.memberships[0].validFrom, "2026-09-10T20:00:00.000Z");
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
