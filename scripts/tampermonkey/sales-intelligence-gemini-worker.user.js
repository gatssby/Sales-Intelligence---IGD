// ==UserScript==
// @name         Sales Intelligence IGD - Gemini Web Worker POC
// @namespace    https://sales-igd.com.br/
// @version      0.1.2
// @description  Worker Tampermonkey para o POC de análise de calls via Gemini Web.
// @author       Sales Intelligence IGD
// @match        https://gemini.google.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @connect      sales-igd.com.br
// @connect      127.0.0.1
// @connect      localhost
// @run-at       document-idle
// ==/UserScript==

(() => {
  "use strict";

  const VERSION = "0.1.2";
  const API_PREFIX = "/api/poc/gemini";
  const CLAIM_POLL_MS = 8_000;
  const HEARTBEAT_MS = 10_000;
  const MODEL_TIMEOUT_MS = 240_000;
  const DOM_WAIT_MS = 20_000;
  const START_MARKER = "<<<IGD_JSON>>>";
  const END_MARKER = "<<<END_IGD_JSON>>>";

  const STORAGE = {
    backendUrl: "igd_gemini_backend_url",
    token: "igd_gemini_worker_token",
    enabled: "igd_gemini_worker_enabled",
    workerId: "igd_gemini_worker_id",
    lastJobId: "igd_gemini_last_job_id",
    completedCount: "igd_gemini_completed_count",
    failedCount: "igd_gemini_failed_count",
  };

  let busy = false;
  let loopTimer = null;
  let heartbeatTimer = null;
  let currentJobId = null;
  let stateText = "inicializando";

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function makeWorkerId() {
    if (globalThis.crypto?.randomUUID) return `gemini-web-${crypto.randomUUID()}`;
    return `gemini-web-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function getWorkerId() {
    const sessionKey = "igd_gemini_tab_worker_id";
    let workerId = sessionStorage.getItem(sessionKey);
    if (!workerId) {
      workerId = makeWorkerId();
      sessionStorage.setItem(sessionKey, workerId);
    }
    return workerId;
  }

  function isEnabled() {
    return GM_getValue(STORAGE.enabled, false) === true;
  }

  function setEnabled(value) {
    GM_setValue(STORAGE.enabled, Boolean(value));
    renderPanel();
  }

  function normalizedBackendUrl() {
    const raw = String(GM_getValue(STORAGE.backendUrl, "") || "").trim();
    if (!raw) return "";

    let url;
    try {
      url = new URL(raw);
    } catch {
      throw new Error("backend_url_invalida");
    }

    const allowedHosts = new Set(["sales-igd.com.br", "127.0.0.1", "localhost"]);
    if (!allowedHosts.has(url.hostname)) throw new Error("backend_host_nao_permitido");

    const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    if (!local && url.protocol !== "https:") throw new Error("backend_remoto_exige_https");
    if (local && !["http:", "https:"].includes(url.protocol)) throw new Error("backend_protocol_invalido");

    return url.origin;
  }

  function getToken() {
    return String(GM_getValue(STORAGE.token, "") || "").trim();
  }

  function setState(text) {
    stateText = text;
    renderPanel();
  }

  function notify(text) {
    try {
      GM_notification({
        title: "Sales Intelligence IGD · Gemini Worker",
        text,
        timeout: 5_000,
      });
    } catch {
      // Notification is optional.
    }
  }

  function log(message, extra = undefined) {
    // Never log token, transcript, prompt, result or raw model response.
    if (extra === undefined) {
      console.info("[IGD Gemini Worker]", message);
    } else {
      console.info("[IGD Gemini Worker]", message, extra);
    }
  }

  class ApiError extends Error {
    constructor(message, status, payload) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.payload = payload;
    }
  }

  function apiRequest(path, body, timeout = 30_000) {
    const backend = normalizedBackendUrl();
    const token = getToken();
    if (!backend) return Promise.reject(new Error("backend_nao_configurado"));
    if (!token) return Promise.reject(new Error("token_nao_configurado"));

    const url = `${backend}${API_PREFIX}${path}`;

    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "POST",
        url,
        timeout,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        data: JSON.stringify(body),
        onload(response) {
          let payload = null;
          if (response.responseText) {
            try {
              payload = JSON.parse(response.responseText);
            } catch {
              payload = { raw: "non_json_response" };
            }
          }

          if (response.status < 200 || response.status >= 300) {
            reject(new ApiError(`api_http_${response.status}`, response.status, payload));
            return;
          }
          resolve(payload);
        },
        ontimeout() {
          reject(new Error("api_timeout"));
        },
        onerror() {
          reject(new Error("api_network_error"));
        },
      });
    });
  }

  function firstString(...values) {
    for (const value of values) {
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
  }

  function transcriptFromJob(job) {
    return firstString(
      job?.transcriptText,
      job?.normalizedText,
      job?.normalized_text,
      job?.transcript,
      job?.transcript?.normalizedText,
      job?.transcript?.normalized_text,
      job?.transcript?.text,
      job?.transcript?.rawText,
      job?.transcript?.raw_text,
    );
  }

  function buildFallbackPrompt(job, transcript) {
    const rubric = firstString(
      job?.rubric,
      job?.rubricText,
      job?.rubric_text,
      "Avalie a qualidade da oportunidade e da condução comercial sem inventar critérios não sustentados pela transcrição."
    );
    const promptVersion = firstString(job?.promptVersion, job?.prompt_version, "poc-v1");

    return `Você audita calls de vendas com rigor.
Separe qualidade da oportunidade de qualidade da condução.
Use SOMENTE evidências presentes na transcrição.
Não invente fatos, falas, timestamps ou resultados.
Rubrica: ${rubric}
Versão do prompt: ${promptVersion}

Retorne UMA ÚNICA análise em JSON válido, sem comentários fora dos delimitadores.

O JSON deve ter exatamente esta estrutura conceitual:
{
  "scoreability": "scoreable" | "unscorable",
  "unscorable_reason": string | null,
  "overall_score": number 0..100 | null,
  "opportunity_quality": "high" | "medium" | "low" | "unqualified" | "unknown",
  "opportunity_quality_label": string,
  "call_outcome": "sold" | "not_sold" | "disqualified" | "follow_up" | "unknown",
  "call_outcome_label": string,
  "confidence": number 0..1,
  "executive_summary": string,
  "strengths": string[],
  "critical_failures": string[],
  "objections": string[],
  "coaching_actions": string[],
  "dimensions": [
    {
      "key": string,
      "label": string,
      "score": number 0..100,
      "rationale": string
    }
  ],
  "evidence": [
    {
      "timestamp": string,
      "speaker": string,
      "criterion": string,
      "quote": string,
      "interpretation": string
    }
  ],
  "requires_human_review": boolean
}

Regras obrigatórias:
- Se scoreability="scoreable", overall_score deve ser número e unscorable_reason deve ser null.
- Se scoreability="unscorable", overall_score deve ser null e unscorable_reason deve explicar o motivo.
- Não atribua score zero para representar falta de evidência.
- Em evidence.quote, use apenas trechos realmente presentes na transcrição.
- Se não houver timestamp explícito, use "n/a"; nunca invente horário.
- Se não houver evidência suficiente para uma dimensão, não invente a dimensão.
- confidence representa sua confiança na análise, não a nota da call.

Responda exatamente assim:
${START_MARKER}
{JSON válido aqui}
${END_MARKER}

TRANSCRIÇÃO:
${transcript}`;
  }

  function promptFromJob(job, transcript) {
    const serverPrompt = firstString(
      job?.analysisPrompt,
      job?.analysis_prompt,
      job?.fullPrompt,
      job?.full_prompt,
      job?.prompt,
    );

    // When present, the backend prompt is authoritative and is expected to be complete.
    return serverPrompt || buildFallbackPrompt(job, transcript);
  }

  function getJobId(job) {
    return firstString(job?.jobId, job?.job_id, job?.id);
  }

  function isVisible(element) {
    if (!(element instanceof HTMLElement)) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
  }

  async function waitFor(getter, timeoutMs, errorCode) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const value = getter();
      if (value) return value;
      await sleep(250);
    }
    throw new Error(errorCode);
  }

  function findNewChatControl() {
    const selectors = [
      'button[aria-label*="New chat" i]',
      'a[aria-label*="New chat" i]',
      'button[aria-label*="Novo chat" i]',
      'a[aria-label*="Novo chat" i]',
      'button[aria-label*="new conversation" i]',
      'a[aria-label*="new conversation" i]',
      'button[data-test-id*="new-chat" i]',
      'a[data-test-id*="new-chat" i]',
      'a[href="/app"]',
      'a[href="https://gemini.google.com/app"]',
    ];

    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        if (isVisible(element)) return element;
      }
    }
    return null;
  }

  function conversationHasMessages() {
    return Boolean(document.querySelector(
      'user-query, .query-text, .user-query, [data-message-author="user"], ' +
      'model-response, message-content, .model-response, .model-response-text, ' +
      '.model-response-contents, .response-content, [data-message-author-role="model"]'
    ));
  }

  function findComposer() {
    const selectors = [
      'rich-textarea [contenteditable="true"]',
      '[contenteditable="true"][role="textbox"]',
      'textarea[aria-label*="prompt" i]',
      'textarea[placeholder*="Gemini" i]',
      'div[contenteditable="true"]',
    ];

    for (const selector of selectors) {
      const candidates = [...document.querySelectorAll(selector)];
      for (let i = candidates.length - 1; i >= 0; i -= 1) {
        const element = candidates[i];
        if (isVisible(element)) return element;
      }
    }
    return null;
  }

  function findSendButton() {
    const selectors = [
      'button[aria-label*="Send message" i]',
      'button[aria-label="Send" i]',
      'button[aria-label*="Enviar" i]',
      'button[data-test-id*="send" i]',
      'button[class*="send" i]',
    ];

    for (const selector of selectors) {
      const candidates = [...document.querySelectorAll(selector)];
      for (let i = candidates.length - 1; i >= 0; i -= 1) {
        const element = candidates[i];
        if (isVisible(element) && !element.disabled && element.getAttribute("aria-disabled") !== "true") {
          return element;
        }
      }
    }
    return null;
  }

  async function startFreshChat() {
    // Gemini's blank /app route often has no visible "New chat" control.
    // A visible composer with no conversation turns is already a fresh chat.
    const currentComposer = findComposer();
    if (currentComposer && !conversationHasMessages()) return currentComposer;

    const control = await waitFor(findNewChatControl, 5_000, "new_chat_control_not_found");
    control.click();
    await sleep(900);

    const composer = await waitFor(findComposer, DOM_WAIT_MS, "composer_not_found_after_new_chat");
    return composer;
  }

  function writeComposer(element, text) {
    element.focus();

    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(element),
        "value"
      )?.set;
      if (setter) setter.call(element, text);
      else element.value = text;

      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }

    element.replaceChildren();
    element.textContent = text;
    try {
      element.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: text,
      }));
    } catch {
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  async function submitPrompt(prompt) {
    const composer = await startFreshChat();
    const assistantBaseline = assistantResponseCandidates().length;

    writeComposer(composer, prompt);
    await sleep(500);

    const button = findSendButton();
    if (button) {
      button.click();
      return assistantBaseline;
    }

    composer.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true,
    }));
    composer.dispatchEvent(new KeyboardEvent("keyup", {
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true,
    }));
    return assistantBaseline;
  }

  function assistantResponseCandidates() {
    const selectors = [
      "model-response",
      "message-content",
      ".model-response",
      ".model-response-text",
      ".model-response-contents",
      ".response-content",
      '[data-message-author-role="model"]',
      '[data-message-author="assistant"]',
      '[data-test-id*="model-response" i]',
    ];

    const unique = new Set();
    const candidates = [];

    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        if (!unique.has(element) && isVisible(element)) {
          unique.add(element);
          candidates.push(element);
        }
      }
    }

    return candidates;
  }

  function findDelimitedAssistantText(minIndex = 0) {
    const candidates = assistantResponseCandidates();
    for (let i = candidates.length - 1; i >= minIndex; i -= 1) {
      const text = candidates[i].innerText || candidates[i].textContent || "";
      if (text.includes(START_MARKER) && text.includes(END_MARKER)) return text;
    }
    return "";
  }

  async function waitForModelResponse(assistantBaseline = 0, timeoutMs = MODEL_TIMEOUT_MS) {
    const started = Date.now();

    return new Promise((resolve, reject) => {
      let settled = false;

      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        clearInterval(interval);
        fn(value);
      };

      const inspect = () => {
        const text = findDelimitedAssistantText(assistantBaseline);
        if (text) {
          finish(resolve, text);
          return;
        }
        if (Date.now() - started >= timeoutMs) {
          finish(reject, new Error("model_response_timeout"));
        }
      };

      const observer = new MutationObserver(inspect);
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
      });

      const interval = setInterval(inspect, 750);
      inspect();
    });
  }

  function extractJson(text) {
    const start = text.lastIndexOf(START_MARKER);
    const end = text.indexOf(END_MARKER, start + START_MARKER.length);
    if (start === -1 || end === -1 || end <= start) throw new Error("json_markers_missing");

    let payload = text.slice(start + START_MARKER.length, end).trim();
    payload = payload.replace(/^\`\`\`(?:json)?\s*/i, "").replace(/\s*\`\`\`$/i, "").trim();

    try {
      return JSON.parse(payload);
    } catch {
      throw new Error("model_json_parse_failed");
    }
  }

  function validateAnalysis(result) {
    const required = [
      "scoreability",
      "unscorable_reason",
      "overall_score",
      "opportunity_quality",
      "opportunity_quality_label",
      "call_outcome",
      "call_outcome_label",
      "confidence",
      "executive_summary",
      "strengths",
      "critical_failures",
      "objections",
      "coaching_actions",
      "dimensions",
      "evidence",
      "requires_human_review",
    ];

    if (!result || typeof result !== "object" || Array.isArray(result)) {
      throw new Error("analysis_not_object");
    }

    for (const key of required) {
      if (!(key in result)) throw new Error(`analysis_missing_${key}`);
    }

    if (!["scoreable", "unscorable"].includes(result.scoreability)) {
      throw new Error("analysis_scoreability_invalid");
    }

    if (result.scoreability === "scoreable") {
      if (typeof result.overall_score !== "number") throw new Error("analysis_score_missing");
      if (result.unscorable_reason !== null) throw new Error("analysis_unscorable_reason_must_be_null");
    } else {
      if (result.overall_score !== null) throw new Error("analysis_unscorable_score_must_be_null");
      if (typeof result.unscorable_reason !== "string" || !result.unscorable_reason.trim()) {
        throw new Error("analysis_unscorable_reason_missing");
      }
    }

    if (typeof result.confidence !== "number" || result.confidence < 0 || result.confidence > 1) {
      throw new Error("analysis_confidence_invalid");
    }

    if (!["high", "medium", "low", "unqualified", "unknown"].includes(result.opportunity_quality)) {
      throw new Error("analysis_opportunity_quality_invalid");
    }

    if (!["sold", "not_sold", "disqualified", "follow_up", "unknown"].includes(result.call_outcome)) {
      throw new Error("analysis_call_outcome_invalid");
    }

    for (const key of ["strengths", "critical_failures", "objections", "coaching_actions", "dimensions", "evidence"]) {
      if (!Array.isArray(result[key])) throw new Error(`analysis_${key}_not_array`);
    }

    if (typeof result.requires_human_review !== "boolean") {
      throw new Error("analysis_requires_human_review_invalid");
    }

    return result;
  }

  function startHeartbeat(jobId) {
    stopHeartbeat();

    const workerId = getWorkerId();
    const send = async () => {
      try {
        await apiRequest("/heartbeat", {
          workerId,
          jobId,
          state: "processing_gemini_web",
        }, 15_000);
      } catch (error) {
        log("heartbeat falhou", {
          jobId,
          code: error instanceof ApiError ? error.status : String(error?.message || error),
        });
      }
    };

    void send();
    heartbeatTimer = setInterval(() => void send(), HEARTBEAT_MS);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  async function failJob(jobId, errorCode, retryable = true) {
    try {
      await apiRequest("/fail", {
        workerId: getWorkerId(),
        jobId,
        errorCode: String(errorCode || "worker_error").slice(0, 120),
        retryable,
      });
    } catch (error) {
      log("não foi possível registrar fail", {
        jobId,
        code: error instanceof ApiError ? error.status : String(error?.message || error),
      });
    }
  }

  async function processJob(job) {
    const jobId = getJobId(job);
    if (!jobId) throw new Error("claim_sem_job_id");

    const transcript = transcriptFromJob(job);
    if (!transcript) {
      await failJob(jobId, "claim_sem_transcript", false);
      throw new Error("claim_sem_transcript");
    }

    const prompt = promptFromJob(job, transcript);
    currentJobId = jobId;
    GM_setValue(STORAGE.lastJobId, jobId);

    const startedAt = performance.now();
    setState(`processando ${jobId.slice(0, 8)}…`);
    startHeartbeat(jobId);

    let completed = false;
    try {
      const assistantBaseline = await submitPrompt(prompt);
      setState(`aguardando Gemini ${jobId.slice(0, 8)}…`);

      const modelText = await waitForModelResponse(assistantBaseline);
      const result = validateAnalysis(extractJson(modelText));
      const latencyMs = Math.round(performance.now() - startedAt);

      setState(`salvando ${jobId.slice(0, 8)}…`);
      await apiRequest("/complete", {
        workerId: getWorkerId(),
        jobId,
        result,
        latencyMs,
        // Deliberately omit rawResponse to avoid persisting model echoes of transcripts/PII.
      });

      completed = true;
      const completedCount = Number(GM_getValue(STORAGE.completedCount, 0) || 0) + 1;
      GM_setValue(STORAGE.completedCount, completedCount);
      setState(`concluído ${jobId.slice(0, 8)} · total ${completedCount}`);
      notify(`Job ${jobId.slice(0, 8)} concluído.`);
      log("job concluído", { jobId, latencyMs });
      await sleep(5_000);
    } catch (error) {
      const code = error instanceof ApiError
        ? `api_${error.status}`
        : String(error?.message || "worker_error");

      // If complete rejected because ownership/lease was lost, do not mutate the job again.
      const lostLease = error instanceof ApiError && error.status === 403;
      const terminalWorkerDomError = [
        "new_chat_control_not_found",
        "composer_not_found_after_new_chat",
        "model_json_parse_failed",
        "json_markers_missing",
      ].includes(code);
      if (!completed && !lostLease) await failJob(jobId, code, !terminalWorkerDomError);

      const failedCount = Number(GM_getValue(STORAGE.failedCount, 0) || 0) + 1;
      GM_setValue(STORAGE.failedCount, failedCount);
      setState(`erro: ${code} · falhas ${failedCount}`);
      notify(`Erro no job ${jobId.slice(0, 8)}: ${code}`);
      throw error;
    } finally {
      stopHeartbeat();
      currentJobId = null;
    }
  }

  async function claimOnce() {
    if (busy) return;
    if (!isEnabled()) {
      setState("desativado");
      return;
    }

    if (!normalizedBackendUrl()) {
      setState("configure backend");
      return;
    }
    if (!getToken()) {
      setState("configure token");
      return;
    }

    busy = true;
    try {
      setState("buscando job…");
      const response = await apiRequest("/claim", {
        workerId: getWorkerId(),
      });

      const job = response?.job ?? null;
      if (!job) {
        setState("idle · sem jobs");
        return;
      }

      await processJob(job);
    } catch (error) {
      const code = error instanceof ApiError
        ? `HTTP ${error.status}`
        : String(error?.message || error);

      setState(`erro: ${code}`);
      log("claim/process falhou", { code });

      if (error instanceof ApiError && error.status === 401) {
        setEnabled(false);
        notify("Token rejeitado. Worker foi desativado.");
      }
    } finally {
      busy = false;
    }
  }

  function scheduleLoop(delay = CLAIM_POLL_MS) {
    clearTimeout(loopTimer);
    loopTimer = setTimeout(async () => {
      await claimOnce();
      scheduleLoop(CLAIM_POLL_MS);
    }, delay);
  }

  function configureBackend() {
    const current = String(GM_getValue(STORAGE.backendUrl, "") || "");
    const value = prompt(
      "Backend do Sales Intelligence IGD. Exemplos:\nhttps://sales-igd.com.br\nhttp://127.0.0.1:3000",
      current || "http://127.0.0.1:3000"
    );
    if (value === null) return;

    GM_setValue(STORAGE.backendUrl, value.trim());
    try {
      normalizedBackendUrl();
      setState("backend configurado");
    } catch (error) {
      GM_setValue(STORAGE.backendUrl, "");
      alert(`Backend inválido: ${error.message}`);
    }
    renderPanel();
  }

  function configureToken() {
    const value = prompt(
      "Cole o GEMINI_POC_WORKER_TOKEN. Ele será salvo apenas no storage privado do Tampermonkey e não será impresso no console:",
      ""
    );
    if (value === null) return;
    GM_setValue(STORAGE.token, value.trim());
    setState(value.trim() ? "token configurado" : "token removido");
    renderPanel();
  }

  function resetWorkerId() {
    if (!confirm("Gerar um novo workerId para esta aba/perfil?")) return;
    const next = makeWorkerId();
    sessionStorage.setItem("igd_gemini_tab_worker_id", next);
    setState("workerId renovado");
    renderPanel();
  }

  function renderPanel() {
    let panel = document.getElementById("igd-gemini-worker-panel");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "igd-gemini-worker-panel";
      Object.assign(panel.style, {
        position: "fixed",
        right: "12px",
        bottom: "12px",
        zIndex: "2147483647",
        padding: "8px 10px",
        borderRadius: "8px",
        background: "rgba(20,20,20,.90)",
        color: "#fff",
        font: "12px/1.35 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
        boxShadow: "0 4px 18px rgba(0,0,0,.28)",
        maxWidth: "290px",
        userSelect: "text",
      });
      document.documentElement.appendChild(panel);
    }

    const worker = getWorkerId();
    panel.textContent = [
      `IGD Gemini Worker v${VERSION}`,
      `${isEnabled() ? "ON" : "OFF"} · ${stateText}`,
      `worker: ${worker.slice(0, 22)}…`,
      currentJobId ? `job: ${currentJobId.slice(0, 12)}…` : "job: —",
      `ok: ${Number(GM_getValue(STORAGE.completedCount, 0) || 0)} · falhas: ${Number(GM_getValue(STORAGE.failedCount, 0) || 0)}`,
    ].join("\n");
    panel.style.whiteSpace = "pre-line";
  }

  GM_registerMenuCommand("IGD: configurar backend", configureBackend);
  GM_registerMenuCommand("IGD: configurar token", configureToken);
  GM_registerMenuCommand("IGD: ativar/desativar worker", () => {
    setEnabled(!isEnabled());
    setState(isEnabled() ? "ativado" : "desativado");
    if (isEnabled()) scheduleLoop(100);
  });
  GM_registerMenuCommand("IGD: buscar job agora", () => void claimOnce());
  GM_registerMenuCommand("IGD: renovar workerId", resetWorkerId);
  GM_registerMenuCommand("IGD: mostrar configuração", () => {
    const backend = String(GM_getValue(STORAGE.backendUrl, "") || "não configurado");
    alert([
      `Versão: ${VERSION}`,
      `Backend: ${backend}`,
      `Worker: ${getWorkerId()}`,
      `Ativo: ${isEnabled() ? "sim" : "não"}`,
      `Último job: ${String(GM_getValue(STORAGE.lastJobId, "") || "—")}`,
      `Token configurado: ${getToken() ? "sim" : "não"}`,
      `Concluídos: ${Number(GM_getValue(STORAGE.completedCount, 0) || 0)}`,
      `Falhas: ${Number(GM_getValue(STORAGE.failedCount, 0) || 0)}`,
    ].join("\n"));
  });

  const launchUrl = new URL(location.href);
  if (launchUrl.searchParams.get("igd_poc_autostart") === "1") {
    setEnabled(true);
    launchUrl.searchParams.delete("igd_poc_autostart");
    history.replaceState(history.state, "", launchUrl.toString());
    setState("ativado pelo launcher");
  }

  renderPanel();
  scheduleLoop(1_500);

  log("userscript carregado", {
    version: VERSION,
    workerId: getWorkerId(),
    enabled: isEnabled(),
    at: nowIso(),
  });
})();
