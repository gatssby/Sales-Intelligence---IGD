import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import postgres from "postgres";
import {
  HUMAN_REVIEW_TRANSCRIPT_SQL,
  applyBlindReviewSubmission,
  buildBlindReviewSession,
  isLoopbackRemoteAddress,
  parseHumanLabelFile,
  resolvePrivateSystemOnePath,
  validateHumanReviewDatabaseSafety,
  validateHumanReviewDatabaseUrl,
  type BlindReviewAnswer,
  type HumanLabelFile,
} from "./lib/system-one-human-labeling.js";

function argument(name: string, fallback?: string): string | undefined {
  return process.argv.slice(2).find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1) ?? fallback;
}
const templatePath = resolvePrivateSystemOnePath(argument("--template", "private/system-one/pilot-30-human-labels-template.json")!, { mustExist: true });
const labelsPath = resolvePrivateSystemOnePath(argument("--labels", "private/system-one/pilot-30-human-labels.json")!, { mustExist: false });
const reviewer = argument("--reviewer")?.trim();
const port = Number(argument("--port", "4317"));
if (!reviewer || reviewer.length > 100) throw new Error("human_review_reviewer_required");
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("human_review_port_invalid");
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL_required_for_human_review");
validateHumanReviewDatabaseUrl(databaseUrl);

const template = parseHumanLabelFile(await readFile(templatePath, "utf8"));
let labels: HumanLabelFile;
try { labels = parseHumanLabelFile(await readFile(labelsPath, "utf8")); }
catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  labels = { ...template, entries: template.entries.map((entry) => ({ ...entry })) };
  await mkdir(dirname(labelsPath), { recursive: true, mode: 0o700 });
  await writeFile(labelsPath, JSON.stringify(labels, null, 2) + "\n", { encoding: "utf8", mode: 0o600, flag: "wx" });
}
const templateIdentity = template.entries.map((entry) => `${entry.call_id}:${entry.decision_key}`).sort();
const labelIdentity = labels.entries.map((entry) => `${entry.call_id}:${entry.decision_key}`).sort();
if (JSON.stringify(templateIdentity) !== JSON.stringify(labelIdentity)) throw new Error("human_review_template_labels_mismatch");
await chmod(dirname(labelsPath), 0o700);
await chmod(labelsPath, 0o600);
const callIds = [...new Set(template.entries.map((entry) => entry.call_id))];

const sql = postgres(databaseUrl, { max: 1, ssl: false });
const [role] = await sql.unsafe<Array<{ role: string; default_transaction_read_only: string; transaction_read_only: string; dangerous_role_attributes: boolean }>>(`
  select current_user role,
    current_setting('default_transaction_read_only') default_transaction_read_only,
    current_setting('transaction_read_only') transaction_read_only,
    (rolsuper or rolcreaterole or rolcreatedb or rolreplication or rolbypassrls) dangerous_role_attributes
  from pg_roles where rolname = current_user
`);
const [membership] = await sql.unsafe<Array<{ inherited_roles: string[] }>>(`
  with recursive memberships(roleid, rolname) as (
    select oid, rolname from pg_roles where rolname = current_user
    union
    select parent.oid, parent.rolname
    from memberships current_membership
    join pg_auth_members edge on edge.member = current_membership.roleid
    join pg_roles parent on parent.oid = edge.roleid
  )
  select coalesce(array_agg(rolname order by rolname) filter (where rolname not in (current_user, 'pg_read_all_data')), '{}') inherited_roles
  from memberships
`);
const [effective] = await sql.unsafe<Array<{ writable_schemas: string[]; writable_relations: string[]; writable_columns: string[]; transcript_readable_columns: string[]; calls_select: boolean; calls_insert: boolean; calls_update: boolean; calls_delete: boolean; calls_truncate: boolean; calls_references: boolean; calls_trigger: boolean; transcripts_select: boolean; transcripts_insert: boolean; transcripts_update: boolean; transcripts_delete: boolean; transcripts_truncate: boolean; transcripts_references: boolean; transcripts_trigger: boolean }>>(`
  select
    coalesce((select array_agg(namespace.nspname order by namespace.nspname)
      from pg_namespace namespace
      where namespace.nspname <> 'information_schema' and namespace.nspname !~ '^pg_'
        and has_schema_privilege(current_user, namespace.oid, 'CREATE')), '{}') writable_schemas,
    coalesce((select array_agg(format('%I.%I', namespace.nspname, relation.relname) order by namespace.nspname, relation.relname)
      from pg_class relation join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname <> 'information_schema' and namespace.nspname !~ '^pg_' and relation.relkind in ('r','p','v','m','f')
        and has_table_privilege(current_user, relation.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')), '{}') writable_relations,
    coalesce((select array_agg(format('%I.%I.%I', namespace.nspname, relation.relname, attribute.attname) order by namespace.nspname, relation.relname, attribute.attname)
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      join pg_attribute attribute on attribute.attrelid = relation.oid and attribute.attnum > 0 and not attribute.attisdropped
      where namespace.nspname <> 'information_schema' and namespace.nspname !~ '^pg_' and relation.relkind in ('r','p','v','m','f')
        and has_column_privilege(current_user, relation.oid, attribute.attnum, 'INSERT,UPDATE,REFERENCES')), '{}') writable_columns,
    coalesce((select array_agg(attribute.attname order by attribute.attname)
      from pg_attribute attribute
      where attribute.attrelid = 'public.transcripts'::regclass and attribute.attnum > 0 and not attribute.attisdropped
        and has_column_privilege(current_user, attribute.attrelid, attribute.attnum, 'SELECT')), '{}') transcript_readable_columns,
    has_table_privilege(current_user, 'public.calls', 'SELECT') calls_select,
    has_table_privilege(current_user, 'public.calls', 'INSERT') calls_insert,
    has_table_privilege(current_user, 'public.calls', 'UPDATE') calls_update,
    has_table_privilege(current_user, 'public.calls', 'DELETE') calls_delete,
    has_table_privilege(current_user, 'public.calls', 'TRUNCATE') calls_truncate,
    has_table_privilege(current_user, 'public.calls', 'REFERENCES') calls_references,
    has_table_privilege(current_user, 'public.calls', 'TRIGGER') calls_trigger,
    has_table_privilege(current_user, 'public.transcripts', 'SELECT') transcripts_select,
    has_table_privilege(current_user, 'public.transcripts', 'INSERT') transcripts_insert,
    has_table_privilege(current_user, 'public.transcripts', 'UPDATE') transcripts_update,
    has_table_privilege(current_user, 'public.transcripts', 'DELETE') transcripts_delete,
    has_table_privilege(current_user, 'public.transcripts', 'TRUNCATE') transcripts_truncate,
    has_table_privilege(current_user, 'public.transcripts', 'REFERENCES') transcripts_references,
    has_table_privilege(current_user, 'public.transcripts', 'TRIGGER') transcripts_trigger
`);
try {
  if (!role || !membership || !effective) throw new Error("human_review_database_role_not_read_only");
  validateHumanReviewDatabaseSafety({
    role: role.role,
    defaultTransactionReadOnly: role.default_transaction_read_only,
    transactionReadOnly: role.transaction_read_only,
    dangerousRoleAttributes: role.dangerous_role_attributes,
    inheritedWritableRoles: membership.inherited_roles,
    writableSchemas: effective.writable_schemas,
    writableRelations: effective.writable_relations,
    writableColumns: effective.writable_columns,
    transcriptReadableColumns: effective.transcript_readable_columns,
    callsPrivileges: { select: effective.calls_select, insert: effective.calls_insert, update: effective.calls_update, delete: effective.calls_delete, truncate: effective.calls_truncate, references: effective.calls_references, trigger: effective.calls_trigger },
    transcriptsPrivileges: { select: effective.transcripts_select, insert: effective.transcripts_insert, update: effective.transcripts_update, delete: effective.transcripts_delete, truncate: effective.transcripts_truncate, references: effective.transcripts_references, trigger: effective.transcripts_trigger },
  });
} catch (error) {
  await sql.end();
  throw error;
}

async function atomicSave(file: HumanLabelFile) {
  const temporary = `${labelsPath}.tmp-${process.pid}`;
  await writeFile(temporary, JSON.stringify(file, null, 2) + "\n", { encoding: "utf8", mode: 0o600, flag: "wx" });
  await chmod(temporary, 0o600);
  await rename(temporary, labelsPath);
  await chmod(labelsPath, 0o600);
}
function headers(response: ServerResponse, status = 200, contentType = "application/json; charset=utf-8") {
  response.writeHead(status, { "content-type": contentType, "cache-control": "no-store, max-age=0", pragma: "no-cache", "x-content-type-options": "nosniff", "x-frame-options": "DENY", "referrer-policy": "no-referrer", "content-security-policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'none'; font-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
}
function json(response: ServerResponse, status: number, value: unknown) { headers(response, status); response.end(JSON.stringify(value)); }
function validLocalRequest(request: IncomingMessage): boolean {
  const host = request.headers.host ?? "";
  return isLoopbackRemoteAddress(request.socket.remoteAddress) && /^(127\.0\.0\.1|localhost):\d+$/.test(host);
}
async function body(request: IncomingMessage): Promise<unknown> {
  let text = "";
  for await (const chunk of request) { text += chunk; if (Buffer.byteLength(text, "utf8") > 64 * 1024) throw new Error("human_review_request_too_large"); }
  return JSON.parse(text);
}
const page = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>System One · Blind Human Review</title><style>
:root{--page:#fff;--surface:#fff;--sidebar:#f6f6f6;--text:#000;--secondary:#7c7c7c;--muted:#5b5b5b;--border:rgba(0,0,0,.1);--accent:#4375ff;--accent-subtle:rgba(67,117,255,.1)}*{box-sizing:border-box}body{margin:0;font:14px Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--text);background:var(--page)}header{height:56px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;padding:0 20px;position:sticky;top:0;background:#fff;z-index:2}.shell{display:grid;grid-template-columns:minmax(420px,1.25fr) minmax(440px,1fr);height:calc(100vh - 56px)}.transcript{padding:24px;overflow:auto;border-right:1px solid var(--border)}.review{padding:24px;overflow:auto;background:var(--sidebar)}.card{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:16px;margin-bottom:16px}.transcript-text{white-space:pre-wrap;line-height:1.55;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}.meta{font-size:12px;color:var(--secondary)}h1{font-size:16px;margin:0}h2{font-size:14px;margin:0 0 8px}.controls{display:flex;gap:8px;align-items:center}.button{border:1px solid var(--border);background:#fff;border-radius:4px;padding:8px 12px;cursor:pointer}.button.primary{background:var(--accent);color:#fff;border-color:var(--accent)}.button:disabled{opacity:.45;cursor:not-allowed}.choice{display:flex;gap:8px;flex-wrap:wrap}.choice label{border:1px solid var(--border);border-radius:4px;padding:7px 9px;cursor:pointer}.choice input{margin-right:6px}textarea{width:100%;min-height:54px;border:1px solid var(--border);border-radius:4px;padding:8px;margin-top:8px;resize:vertical}.status{padding:7px 10px;border-radius:4px;background:var(--accent-subtle)}@media(max-width:900px){.shell{grid-template-columns:1fr;height:auto}.transcript{border-right:0;border-bottom:1px solid var(--border);max-height:50vh}.review{overflow:visible}}
</style></head><body><header><div><h1>System One · revisão humana cega</h1><div class="meta" id="progress">Carregando…</div></div><div class="controls"><button class="button" id="prev">Anterior</button><span class="status" id="call-number">Call</span><button class="button" id="next">Próxima</button><button class="button primary" id="save">Salvar</button></div></header><main class="shell"><section class="transcript"><div class="meta">Transcript exibido apenas nesta sessão localhost. Não é gravado em arquivo.</div><div class="card transcript-text" id="transcript">Carregando…</div></section><section class="review" id="questions"></section></main><script>
let session,index=0,current;const $=s=>document.querySelector(s);const escapeValue=v=>v===null?'null':String(v);async function api(url,options){const response=await fetch(url,{cache:'no-store',...options});if(!response.ok)throw new Error((await response.json()).error||'request_failed');return response.json()}function inputFor(q,label){const box=document.createElement('div');box.className='choice';const values=q.type==='noul'?[true,false,null]:q.type==='score'?[1,2,3,4,5,null]:[...q.options.map(x=>x.value),null];for(const value of values){const item=document.createElement('label'),input=document.createElement('input');input.type='radio';input.name=q.key;input.value=escapeValue(value);if(label&&((value===null&&label.human_value===null&&label.reviewed_at)||(label.human_value===value)))input.checked=true;item.append(input,document.createTextNode(value===null?'Uncertain / null':q.type==='choice'?(q.options.find(x=>x.value===value)?.label||value):String(value)));box.append(item)}return box}function render(){const root=$('#questions');root.textContent='';for(const q of session.questions){const label=current.labels.find(x=>x.decision_key===q.key);const card=document.createElement('div');card.className='card';const title=document.createElement('h2');title.textContent=q.key;const instructions=document.createElement('div');instructions.className='meta';instructions.textContent=q.instructions;const choices=inputFor(q,label);const notes=document.createElement('textarea');notes.dataset.notes=q.key;notes.placeholder='Notes opcionais — sem copiar transcript';notes.value=label?.notes||'';card.append(title,instructions,choices,notes);root.append(card)}$('#transcript').textContent=current.transcript;$('#call-number').textContent='Call '+String(index+1).padStart(2,'0')+' / '+session.callCount;$('#progress').textContent=session.completedCalls+' de '+session.callCount+' calls concluídas';$('#prev').disabled=index===0;$('#next').disabled=index===session.callCount-1}async function load(){current=await api('/api/call?index='+index);render()}async function save(){const answers=session.questions.map(q=>{const checked=document.querySelector('input[name="'+q.key+'"]:checked');if(!checked)throw new Error('Preencha '+q.key+' ou marque uncertain/null');const raw=checked.value;const humanValue=raw==='null'?null:q.type==='noul'?raw==='true':q.type==='score'?Number(raw):raw;return{decisionKey:q.key,humanValue,notes:document.querySelector('[data-notes="'+q.key+'"]').value||null}});await api('/api/call?index='+index,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({answers})});session=await api('/api/session');await load()}$('#prev').onclick=async()=>{if(index>0){index--;await load()}};$('#next').onclick=async()=>{if(index<session.callCount-1){index++;await load()}};$('#save').onclick=()=>save().catch(e=>alert(e.message));(async()=>{session=await api('/api/session');await load()})().catch(e=>{$('#transcript').textContent=e.message});
</script></body></html>`;

const server = createServer(async (request, response) => {
  try {
    if (!validLocalRequest(request)) return json(response, 403, { error: "localhost_only" });
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
    if (request.method === "GET" && url.pathname === "/") { headers(response, 200, "text/html; charset=utf-8"); return response.end(page); }
    if (request.method === "GET" && url.pathname === "/api/session") return json(response, 200, buildBlindReviewSession(labels));
    if (url.pathname === "/api/call") {
      const index = Number(url.searchParams.get("index"));
      if (!Number.isInteger(index) || index < 0 || index >= callIds.length) return json(response, 404, { error: "call_not_found" });
      const callId = callIds[index]!;
      if (request.method === "GET") {
        const rows = await sql.unsafe<Array<{ transcript: string }>>(HUMAN_REVIEW_TRANSCRIPT_SQL, [callId]);
        if (rows.length !== 1 || typeof rows[0]?.transcript !== "string") return json(response, 404, { error: "transcript_not_found" });
        return json(response, 200, { callIndex: String(index + 1).padStart(2, "0"), transcript: rows[0].transcript, labels: labels.entries.filter((entry) => entry.call_id === callId).map(({ decision_key, human_value, reviewed_at, notes }) => ({ decision_key, human_value, reviewed_at, notes })) });
      }
      if (request.method === "PUT") {
        const origin = request.headers.origin;
        if (!origin || !new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]).has(origin)) return json(response, 403, { error: "origin_not_allowed" });
        const candidate = await body(request) as { answers?: BlindReviewAnswer[] };
        labels = applyBlindReviewSubmission(labels, { callId, reviewer, reviewedAt: new Date().toISOString(), answers: candidate.answers ?? [] });
        await atomicSave(labels);
        return json(response, 200, { saved: true });
      }
    }
    return json(response, 404, { error: "not_found" });
  } catch (error) {
    return json(response, 400, { error: error instanceof Error ? error.message : "human_review_failed" });
  }
});
server.listen(port, "127.0.0.1", () => console.log(`System One blind review ready at http://127.0.0.1:${port} (${callIds.length} calls; predictions hidden)`));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, async () => { server.close(); await sql.end(); process.exit(0); });
