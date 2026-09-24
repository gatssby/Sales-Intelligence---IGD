# Laya challenger

Laya is a local challenger with the same typed decision schema as Jev. Production does not depend on the developer Mac.

```text
LAYA_BASE_URL=http://127.0.0.1:8000
LAYA_MODEL=convaiinnovations/laya-typed-decisions
LAYA_MODEL_VERSION=local
```

The adapter defaults to `http://127.0.0.1:8000` and expects `/health` and `/v1/decisions`. The local server contract is read from its own `/openapi.json`; no `model` field is sent in the request because the server fixes the active checkpoint at startup.

The domain question schema remains provider-agnostic. At the Laya transport boundary:

- `choice` is sent with its named `criteria` map;
- `noul` is sent with `type` and `instructions` (optional false/true criteria are supported by the server);
- domain `score { minimum, maximum }` is sent as ordered string `levels` covering the inclusive range.

The local `laya-mps` response represents score as a probability-weighted, zero-based position over `levels`. It returns probabilities as an ordered array and a zero-based `legend`. The adapter requires the requested answer keys exactly, validates score probability sums/length, zero-based legend keys and values, then preserves the raw provider score and legend in metadata, adds the domain minimum to produce the domain value, and normalizes by `levels.length - 1`. This differs from the TypeSafe/Jev wire API, which currently uses `criteria` for score and a keyed probability map; the two transports therefore must not share an unqualified wire codec.

Health exposes readiness without exposing model files or PII.

## Apple Silicon local demonstration

The local source checkout is intentionally separate from this repository:

```bash
bash scripts/setup-laya-local.sh
cd ~/.cache/sales-intelligence/laya-mps
./scripts/serve.sh --memory reduced --device mps --port 8000
```

The first `serve.sh` run installs its isolated runtime and downloads the `convaiinnovations/laya-typed-decisions` checkpoint. The upstream project documents approximately 843 MB for the model and recommends 4 GB free disk space. Approve that download explicitly before running the third command.

In a second terminal, verify and run only synthetic data:

```bash
curl --fail-with-body -sS http://127.0.0.1:8000/health
npm run system-one:lab -- --provider=laya --live --calls=2
npm run system-one:benchmark
```

A local service must pass health and synthetic decision checks before it is used for benchmarks. No production process imports or depends on the local service.
