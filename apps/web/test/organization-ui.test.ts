import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { OrganizationTreeRow } from "@igd/db";
import { OrganizationScopeSelector } from "../app/components/OrganizationScopeSelector.js";

function row(input: Partial<OrganizationTreeRow>): OrganizationTreeRow {
  return {
    product_key: "alpha", product_name: "Alpha", front_key: "closers", front_name: "Closers",
    team_id: "team-a", team_key: "alpha:closers:a", team_name: "Time A",
    leader_id: "leader-a", leader_code: "V9000", leader_name: "Leader Synthetic",
    person_id: "person-a", person_code: "V9001", person_name: "Person Synthetic", person_active: true,
    organization_attributes: {}, ...input,
  };
}

test("scope selector is dependent and renders only server-authorized options", () => {
  const authorized = [
    row({}),
    row({ product_key: "beta", product_name: "Beta", team_id: "team-b", team_key: "beta:closers:b", team_name: "Time B", person_id: "person-b", person_code: "V9002", person_name: "Outside Selected Product" }),
  ];
  const dependent = renderToStaticMarkup(createElement(OrganizationScopeSelector, { pathname: "/calls", selected: { productKey: "alpha" }, rows: authorized }));
  assert.match(dependent, /Time A/);
  assert.doesNotMatch(dependent, /Time B/);
  assert.doesNotMatch(dependent, /Outside Selected Product/);

  const restricted = renderToStaticMarkup(createElement(OrganizationScopeSelector, { pathname: "/calls", selected: {}, rows: [authorized[0]] }));
  assert.doesNotMatch(restricted, /Beta/);
  assert.doesNotMatch(restricted, /team-b/);
});

test("Organization Explorer drills into the same dashboard and calls scope", async () => {
  const source = await readFile(new URL("../app/organization/page.tsx", import.meta.url), "utf8");
  assert.match(source, /scopeHref\("\/",/);
  assert.match(source, /scopeHref\("\/calls",/);
  assert.match(source, /OrganizationScopeSelector/);
});

test("selected Person profile exposes organizational attributes, evolution and coaching", async () => {
  const source = await readFile(new URL("../app/people/page.tsx", import.meta.url), "utf8");
  assert.match(source, /Perfil canônico/);
  assert.match(source, /Evolução recente/);
  assert.match(source, /Coaching atual/);
  assert.match(source, /getDashboardData\(user, selected, asOf\.value \? \{ from: asOf\.start, through: asOf\.date \} : \{\}\)/);
});

test("calls and progress APIs apply the URL-selected scope server-side", async () => {
  const [callsSource,progressSource,detailSource,transcriptSource] = await Promise.all([
    readFile(new URL("../app/api/calls/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/progress/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/calls/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/calls/[id]/transcript/route.ts", import.meta.url), "utf8"),
  ]);
  for (const source of [callsSource,progressSource,detailSource,transcriptSource]) {
    assert.match(source, /parseOrganizationSelection/);
    assert.match(source, /getProgressData\(user, selected\)|getCallCatalogPage\(user, page, pageSize, selected\)|getCallDetail\(user, \(await context.params\)\.id, selected\)|getCallTranscript\(user, \(await context.params\)\.id, selected\)/);
  }
});
