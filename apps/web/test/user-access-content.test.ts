import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { accessRoleLabels } from "../app/admin/users/accessProfiles.js";
import { UserAccessManager } from "../app/admin/users/UserAccessManager.js";

test("access labels cover every organizational cargo and keep Platform Admin explicit", () => {
  assert.deepEqual(accessRoleLabels, {
    PLATFORM_ADMIN: "Administrador da Plataforma",
    ADMIN: "Administrador",
    SUPERVISOR: "Supervisor",
    LEADER: "Líder",
    LEADER_IN_TRAINING: "Líder em treinamento",
    CLOSER: "Closer",
    SDR: "SDR",
    USER: "Pessoa sem cargo calculado",
    SALES_OPS: "Acesso anterior sem vínculo",
  });
});

test("new accounts expose Organization IGD and Manual as explicit access origins", () => {
  const html = renderToStaticMarkup(React.createElement(UserAccessManager, {
    users: [],
    teams: [],
    products: [],
    people: [{ id: "person-a", code: "V9001", label: "Pessoa Sintética", accessRole: "CLOSER", organizationManaged: true }],
  }));

  assert.match(html, /name="role" value="ORGANIZATION"/);
  assert.match(html, /<select name="personId"[^>]*required/);
  assert.match(html, /Organização IGD/);
  assert.match(html, /Manual/);
  assert.match(html, /Cargo, Produto, Frente, Time e liderança são derivados/);
  assert.match(html, /Administrador da Plataforma não é concedido/);
  assert.doesNotMatch(html, /name="teamIds"|name="productKeys"/);
});

test("linked account renders calculated cargo and friendly scope labels", () => {
  const html = renderToStaticMarkup(React.createElement(UserAccessManager, {
    users: [{
      id: "user-a", email: "person@example.invalid", displayName: "Pessoa Sintética", role: "ORGANIZATION", accessRole: "LEADER",
      active: true, mustChangePassword: false, lastLoginAt: null,
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      personId: "person-a", teamIds: ["team-a"], productKeys: [], personIds: ["person-a"],
      accessOrigin: "ORGANIZATION", personCode: "V9001", personName: "Pessoa Sintética",
      organizationProductNames: ["INSIDER"], organizationFrontNames: ["CLOSERS"], organizationTeamNames: ["Time A"], organizationMatch: null,
    }],
    teams: [{ id: "team-a", label: "Time A" }],
    products: [],
    people: [{ id: "person-a", code: "V9001", label: "Pessoa Sintética", accessRole: "LEADER", organizationManaged: true }],
  }));

  assert.match(html, /Cargo:<\/strong> Líder/);
  assert.match(html, /Origem do acesso:<\/strong> Organização IGD/);
  assert.match(html, /Frente:<\/strong> CLOSERS/);
  assert.match(html, /Abrangência:<\/strong> Times: Time A/);
  assert.doesNotMatch(html, /team-a/);
});

test("Platform Admin account is protected from the commercial access manager", () => {
  const html = renderToStaticMarkup(React.createElement(UserAccessManager, {
    users: [{
      id: "platform-a", email: "platform@example.invalid", displayName: "Administrador Técnico", role: "PLATFORM_ADMIN", accessRole: "PLATFORM_ADMIN",
      active: true, mustChangePassword: false, lastLoginAt: null,
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      personId: null, teamIds: [], productKeys: [], personIds: [],
      accessOrigin: "SYSTEM", personCode: null, personName: null,
      organizationProductNames: [], organizationFrontNames: [], organizationTeamNames: [], organizationMatch: null,
    }],
    teams: [], products: [], people: [],
  }));

  assert.match(html, /Privilégio protegido por configuração interna/);
  assert.doesNotMatch(html, /Desativar conta|Gerar senha temporária/);
});

test("users and access UI uses natural commercial language", async () => {
  const sources = await Promise.all([
    readFile(new URL("../app/admin/users/UserAccessManager.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/users/page.tsx", import.meta.url), "utf8"),
  ]);
  const content = sources.join("\n");

  assert.match(content, /Cargo/);
  assert.match(content, /Abrangência/);
  assert.match(content, /Pessoa vinculada/);
  assert.match(content, /Conta ativa/);
  assert.match(content, /Administrador da Plataforma/);
  assert.match(content, /Será calculada pela organização ao salvar/);
  assert.match(content, /Vínculo organizacional disponível/);
  assert.doesNotMatch(content, /Papel de sistema|Effective scope|Leader legado|Sales Ops|Admin do sistema|Pessoa: self/);
});
