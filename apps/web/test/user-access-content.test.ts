import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { accessProfileContent, accessProfileOrder, hasCompatibleLegacyScope, requiresPersonLink } from "../app/admin/users/accessProfiles.js";
import { UserAccessManager } from "../app/admin/users/UserAccessManager.js";

test("access profiles use clear pt-BR labels and match the supported authorization roles", () => {
  assert.deepEqual(accessProfileOrder, ["ADMIN", "SUPERVISOR", "LEADER", "USER", "SALES_OPS"]);
  assert.deepEqual(accessProfileOrder.map((role) => accessProfileContent[role].label), [
    "Administrador",
    "Supervisor",
    "Líder",
    "Pessoa",
    "Operações comerciais",
  ]);
  assert.equal(requiresPersonLink("ADMIN"), false);
  assert.equal(requiresPersonLink("SALES_OPS"), false);
  assert.equal(requiresPersonLink("SUPERVISOR"), true);
  assert.equal(requiresPersonLink("LEADER"), true);
  assert.equal(requiresPersonLink("USER"), true);
});

test("legacy scopes are retained only for their compatible access profile", () => {
  assert.equal(hasCompatibleLegacyScope("LEADER", ["team-a"], []), true);
  assert.equal(hasCompatibleLegacyScope("LEADER", [], ["product-a"]), false);
  assert.equal(hasCompatibleLegacyScope("SUPERVISOR", [], ["product-a"]), true);
  assert.equal(hasCompatibleLegacyScope("SUPERVISOR", ["team-a"], []), false);
  assert.equal(hasCompatibleLegacyScope("ADMIN", ["team-a"], ["product-a"]), false);
  assert.equal(hasCompatibleLegacyScope("SALES_OPS", ["team-a"], ["product-a"]), false);
  assert.equal(hasCompatibleLegacyScope("USER", ["team-a"], ["product-a"]), false);
});

test("new account form renders every supported commercial profile without manual scope fields", () => {
  const html = renderToStaticMarkup(React.createElement(UserAccessManager, {
    users: [],
    teams: [],
    products: [],
    people: [],
  }));

  for (const label of accessProfileOrder.map((role) => accessProfileContent[role].label)) {
    assert.match(html, new RegExp(`>${label}<`));
  }
  assert.doesNotMatch(html, /name="teamIds"|name="productKeys"/);
});

test("linked organizational profiles keep the Person link required while legacy scopes remain compatible", () => {
  const baseUser = {
    id: "user-a", email: "person@example.invalid", displayName: "Pessoa Sintética", role: "LEADER" as const,
    active: true, mustChangePassword: false, lastLoginAt: null,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    personId: "person-a", teamIds: ["team-a"], productKeys: [], personIds: ["person-a"],
  };
  const people = [{ id: "person-a", code: "V9001", label: "Pessoa Sintética" }];
  const linkedHtml = renderToStaticMarkup(React.createElement(UserAccessManager, {
    users: [baseUser], teams: [{ id: "team-a", label: "Time A" }], products: [], people,
  }));
  const linkedPersonSelects = linkedHtml.match(/<select name="personId"[^>]*>/g) ?? [];
  assert.equal(linkedPersonSelects.length, 2);
  assert.match(linkedPersonSelects[1], /required/);

  const legacyHtml = renderToStaticMarkup(React.createElement(UserAccessManager, {
    users: [{ ...baseUser, personId: null, personIds: [] }], teams: [{ id: "team-a", label: "Time A" }], products: [], people,
  }));
  const legacyPersonSelects = legacyHtml.match(/<select name="personId"[^>]*>/g) ?? [];
  assert.equal(legacyPersonSelects.length, 2);
  assert.doesNotMatch(legacyPersonSelects[1], /required/);
});

test("users and access UI avoids implementation terminology", async () => {
  const sources = await Promise.all([
    readFile(new URL("../app/admin/users/UserAccessManager.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/users/page.tsx", import.meta.url), "utf8"),
  ]);
  const content = sources.join("\n");

  assert.match(content, /Perfil de acesso/);
  assert.match(content, /Pessoa vinculada/);
  assert.match(content, /Conta ativa/);
  assert.match(content, /Administrador da Plataforma/);
  assert.match(content, /AdminBadge label="Administrador"/);
  assert.match(content, /Será recalculada pela organização após salvar/);
  assert.doesNotMatch(content, /Papel de sistema|Effective scope|Leader legado|Sales Ops|Admin do sistema|Pessoa: self/);
});
