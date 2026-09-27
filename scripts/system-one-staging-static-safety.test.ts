import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  SyntaxKind,
  isCallExpression,
  isExportDeclaration,
  isIdentifier,
  isImportDeclaration,
  isStringLiteralLikeNode,
  type Node,
  type SourceFile,
} from "typescript/unstable/ast";
import { API, type Snapshot } from "typescript/unstable/sync";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUNNER_PATH = join(REPOSITORY_ROOT, "scripts/system-one-staging-read-model.ts");
const ADAPTER_PATH = join(REPOSITORY_ROOT, "scripts/lib/system-one-staging-artifacts.ts");

type DependencyClosureResult = {
  readonly visitedFiles: readonly string[];
};

async function assertOfflineDependencyClosure(_roots: readonly string[]): Promise<DependencyClosureResult> {
  if (_roots.length === 0) throw new Error("dependency_closure_roots_missing");
  const roots = await Promise.all(_roots.map((path) => realpath(path)));
  const allowedRoots = roots.every((path) => isWithin(path, REPOSITORY_ROOT))
    ? [REPOSITORY_ROOT]
    : [...new Set(roots.map((path) => dirname(path)))];
  const api = new API();
  const snapshot = api.updateSnapshot({ openFiles: roots });
  try {
    const visited = new Set<string>();
    const pending = [...roots];
    while (pending.length > 0) {
      const path = pending.pop()!;
      if (visited.has(path)) continue;
      if (!allowedRoots.some((root) => isWithin(path, root))) {
        throw new Error(`dependency_graph_escape:${path}`);
      }
      const source = await readFile(path, "utf8");
      const sourceFile = sourceFileForPath(snapshot, path);
      if (!sourceFile) throw new Error(`typescript_source_unresolved:${path}`);
      scanForbiddenExecutableTokens(path, source, sourceFile);
      visited.add(path);
      for (const specifier of collectModuleSpecifiers(sourceFile, path)) {
        const forbidden = forbiddenDependency(specifier);
        if (forbidden) throw new Error(`forbidden_dependency:${forbidden}:${path}`);
        if (ALLOWED_NODE_BUILTINS.has(specifier)) continue;
        if (specifier === "@igd/core/system-one-staging-read-model") {
          pending.push(await realpath(join(REPOSITORY_ROOT, "packages/core/src/system-one-staging-read-model.ts")));
          continue;
        }
        if (specifier.startsWith(".") || specifier.startsWith("/")) {
          pending.push(await resolveLocalImport(path, specifier, allowedRoots));
          continue;
        }
        throw new Error(`unapproved_dependency:${specifier}:${path}`);
      }
    }
    return { visitedFiles: [...visited].sort() };
  } finally {
    snapshot.dispose();
    api.close();
  }
}

function sourceFileForPath(snapshot: Snapshot, path: string): SourceFile | undefined {
  for (const project of snapshot.getProjects()) {
    const sourceFile = project.program.getSourceFile(path);
    if (sourceFile) return sourceFile;
  }
  return undefined;
}

const ALLOWED_NODE_BUILTINS = new Set([
  "node:assert",
  "node:assert/strict",
  "node:crypto",
  "node:fs",
  "node:fs/promises",
  "node:path",
  "node:url",
  "node:test",
]);

const FORBIDDEN_DEPENDENCY_PREFIXES = [
  "axios",
  "pg",
  "postgres",
  "postgresql",
  "@googleapis",
  "googleapis",
  "google-auth-library",
  "openai",
  "@ai-sdk",
  "ai",
  "undici",
  "node:http",
  "node:https",
  "http",
  "https",
  "whisper",
  "assemblyai",
  "deepgram",
  "speech-to-text",
  "@google-cloud/speech",
];

function isWithin(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`);
}

function forbiddenDependency(specifier: string): string | null {
  const lower = specifier.toLowerCase();
  for (const prefix of FORBIDDEN_DEPENDENCY_PREFIXES) {
    if (lower === prefix || lower.startsWith(`${prefix}/`)) return specifier;
  }
  if (
    lower.includes("gemini")
    || lower.includes("jev")
    || lower.includes("laya")
    || lower.includes("transcript-reader")
    || lower.includes("transcript-fetch")
    || lower.includes("asr")
  ) return specifier;
  return null;
}

function collectModuleSpecifiers(sourceFile: SourceFile, path: string): string[] {
  const specifiers: string[] = [];
  const visit = (node: Node): void => {
    if (
      (isImportDeclaration(node) || isExportDeclaration(node))
      && node.moduleSpecifier
      && isStringLiteralLikeNode(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (isCallExpression(node) && node.expression.kind === SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      if (!argument || !isStringLiteralLikeNode(argument)) {
        throw new Error(`non_literal_dynamic_import:${path}`);
      }
      specifiers.push(argument.text);
    }
    if (
      isCallExpression(node)
      && isIdentifier(node.expression)
      && node.expression.text === "require"
    ) {
      const argument = node.arguments[0];
      if (!argument || !isStringLiteralLikeNode(argument)) throw new Error(`non_literal_require:${path}`);
      specifiers.push(argument.text);
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return specifiers;
}

async function resolveLocalImport(
  importer: string,
  specifier: string,
  allowedRoots: readonly string[],
): Promise<string> {
  const base = resolve(dirname(importer), specifier);
  const extension = extname(base);
  const candidates = new Set<string>();
  if ([".js", ".mjs", ".cjs"].includes(extension)) {
    const withoutExtension = base.slice(0, -extension.length);
    for (const candidateExtension of [".ts", ".tsx", ".mts", ".cts"]) {
      candidates.add(`${withoutExtension}${candidateExtension}`);
    }
  } else if ([".ts", ".tsx", ".mts", ".cts"].includes(extension)) {
    candidates.add(base);
  } else if (extension.length === 0) {
    for (const candidateExtension of [".ts", ".tsx", ".mts", ".cts"]) {
      candidates.add(`${base}${candidateExtension}`);
      candidates.add(join(base, `index${candidateExtension}`));
    }
  }
  for (const candidate of candidates) {
    try {
      await access(candidate);
      const resolved = await realpath(candidate);
      if (!allowedRoots.some((root) => isWithin(resolved, root))) {
        throw new Error(`dependency_graph_escape:${resolved}`);
      }
      return resolved;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
  }
  throw new Error(`unresolved_local_import:${specifier}:${importer}`);
}

function scanForbiddenExecutableTokens(path: string, source: string, sourceFile: SourceFile): void {
  const visit = (node: Node): void => {
    if (
      isCallExpression(node)
      && isIdentifier(node.expression)
      && node.expression.text === "fetch"
    ) throw new Error(`forbidden_executable_token:fetch:${path}`);
    node.forEachChild(visit);
  };
  visit(sourceFile);
  const forbiddenTokens: readonly [RegExp, string][] = [
    [/public\.calls/, "public.calls"],
    [/source_locations/, "source_locations"],
    [/[\\/]migrations[\\/]/, "migrations"],
    [/transcript_body|transcriptBody/, "transcript_body"],
    [/(fetch|read|download)(Transcript|TranscriptBody)/, "transcript_reader"],
  ];
  for (const [pattern, label] of forbiddenTokens) {
    if (pattern.test(source)) throw new Error(`forbidden_executable_token:${label}:${path}`);
  }
  if (isWithin(path, join(REPOSITORY_ROOT, "packages/core")) && /private[\\/]system-one/.test(source)) {
    throw new Error(`forbidden_private_dependency:${path}`);
  }
}

async function readVisitedClosureSources(roots: readonly string[]): Promise<string> {
  const result = await assertOfflineDependencyClosure(roots);
  return (await Promise.all(result.visitedFiles.map((path) => readFile(path, "utf8")))).join("\n");
}

async function makeSyntheticImportGraph(files: Readonly<Record<string, string>>) {
  const root = await mkdtemp(join(process.env.TMPDIR!, "system-one-static-safety-"));
  for (const [relativePath, source] of Object.entries(files)) {
    const path = join(root, relativePath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, source, "utf8");
  }
  return {
    path: (relativePath: string) => join(root, relativePath),
  };
}

test("offline staging import closure rejects a forbidden transitive network module", async () => {
  const fixture = await makeSyntheticImportGraph({
    "runner.ts": 'import "./local-helper.js";',
    "local-helper.ts": 'import axios from "axios"; export const helper = axios;',
  });

  await assert.rejects(
    () => assertOfflineDependencyClosure([fixture.path("runner.ts")]),
    /forbidden_dependency:axios/,
  );
});

test("offline staging closure rejects transitive database, Drive, provider, and network paths", async () => {
  const forbiddenCases = [
    ["pg", 'import pg from "pg"; export default pg;'],
    ["googleapis", 'import { google } from "googleapis"; export default google;'],
    ["openai", 'import OpenAI from "openai"; export default OpenAI;'],
    ["node:http", 'import http from "node:http"; export default http;'],
    ["undici", 'import { request } from "undici"; export default request;'],
  ] as const;
  for (const [specifier, helperSource] of forbiddenCases) {
    const fixture = await makeSyntheticImportGraph({
      "runner.ts": 'import "./helper.js";',
      "helper.ts": helperSource,
    });
    await assert.rejects(
      () => assertOfflineDependencyClosure([fixture.path("runner.ts")]),
      new RegExp(`forbidden_dependency:${specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
    );
  }
  const fetchFixture = await makeSyntheticImportGraph({
    "runner.ts": 'import "./helper.js";',
    "helper.ts": 'export async function helper() { return fetch("https://example.invalid"); }',
  });
  await assert.rejects(
    () => assertOfflineDependencyClosure([fetchFixture.path("runner.ts")]),
    /forbidden_executable_token:fetch/,
  );
});

test("real runner and adapter import closure is offline-only", async () => {
  const result = await assertOfflineDependencyClosure([RUNNER_PATH, ADAPTER_PATH]);
  assert.ok(result.visitedFiles.includes(RUNNER_PATH));
  assert.ok(result.visitedFiles.includes(ADAPTER_PATH));
  assert.ok(result.visitedFiles.some((path) => path.endsWith("packages/core/src/system-one-staging-read-model.ts")));
  assert.ok(result.visitedFiles.some((path) => path.endsWith("scripts/lib/system-one-identity-rule-validation.ts")));
});

test("runner closure references only private system-one outputs and no production persistence paths", async () => {
  const sources = await readVisitedClosureSources([RUNNER_PATH, ADAPTER_PATH]);
  assert.match(sources, /private[\\/]system-one/);
  assert.doesNotMatch(sources, /public\.calls|source_locations|packages[\\/]db[\\/]migrations/);
});
