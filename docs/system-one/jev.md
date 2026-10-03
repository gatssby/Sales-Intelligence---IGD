# Jev champion

Jev is the initial champion/baseline. The client runs locally in this repository and calls the remote provider through `JevDecisionEngine`. The default transport is TypeSafe direct; the domain remains provider and transport agnostic.

Configuration is local only:

```text
JEV_TRANSPORT=typesafe-direct
TYPESAFE_API_KEY=
TYPESAFE_BASE_URL=https://api.typesafe.ai
JEV_MODEL=jev-latest
JEV_MODEL_VERSION=
```

When `TYPESAFE_API_KEY` is absent, the adapter remains testable through injected fetch/mocks and reports `missing_typesafe_api_key`; it does not fabricate a result.

The direct transport sends `POST https://api.typesafe.ai/v1/systemone` with `model: jev-latest`, state and typed questions. It maps `noul`, `choice` and `score` answers into the normalized domain shape; TypeSafe token usage remains snake_case only at the boundary and is normalized to `inputTokens` and `outputTokens` internally. The returned model is retained, including a resolved version such as `jev-1.13.0`. Responses must contain exactly the requested decision keys and validated probabilities before entering the domain.

`npm run system-one:health` is configuration-only and never probes a remote provider. Use `npm run system-one:health -- --check-live` to make the explicit, non-inference `GET /v1/models` probe, which reports `configured`, `reachable`, `authorized` and `liveAvailable` separately.

The legacy `vercel-ai-gateway` transport remains available only when selected explicitly with `JEV_TRANSPORT=vercel-ai-gateway`; it retains its own `AI_GATEWAY_API_KEY` configuration and does not affect the direct TypeSafe path.

For the local demonstration without a key, use the deterministic mock path:

```bash
npm run system-one:lab -- --provider=jev --calls=2
```

For a live synthetic call only after `TYPESAFE_API_KEY` is present in the local secret store/environment:

```bash
npm run system-one:health -- --check-live
npm run system-one:lab -- --provider=jev --live --calls=2
```

Never place the key in `.env.example`, Git, terminal recordings, or chat.
