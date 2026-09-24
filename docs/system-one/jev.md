# Jev champion

Jev is the initial champion/baseline. The client runs locally in this repository and calls the remote provider through `JevDecisionEngine`. The default transport is Vercel AI Gateway; the domain remains provider and transport agnostic.

Configuration is local only:

```text
JEV_TRANSPORT=vercel-ai-gateway
AI_GATEWAY_API_KEY=
AI_GATEWAY_BASE_URL=https://ai-gateway.vercel.sh/v1
JEV_MODEL=typesafe-ai/jev
JEV_MODEL_VERSION=
```

When `AI_GATEWAY_API_KEY` is absent, the adapter remains testable through injected fetch/mocks and reports `missing_ai_gateway_api_key`; it does not fabricate a result.

The Vercel transport sends `POST https://ai-gateway.vercel.sh/v1/evaluate` with `model: typesafe-ai/jev`, state and typed questions. Internal `noul` questions are translated only at this boundary to Vercel's `boolean` type; choice and score schemas stay typed. Responses must contain exactly the requested decision keys and validated probabilities before entering the domain.

For the local demonstration without a key, use the deterministic mock path:

```bash
npm run system-one:lab -- --provider=jev --calls=2
```

For a live call only after `AI_GATEWAY_API_KEY` is present in the local secret store/environment:

```bash
npm run system-one:health
npm run system-one:lab -- --provider=jev --live --calls=2
```

Never place the key in `.env.example`, Git, terminal recordings, or chat.
