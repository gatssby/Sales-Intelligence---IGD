# Laya challenger

Laya is a local challenger with the same typed decision schema as Jev. Production does not depend on the developer Mac.

```text
LAYA_BASE_URL=http://127.0.0.1:8787
LAYA_MODEL=sales-decision
LAYA_MODEL_VERSION=local
```

The adapter defaults to `http://127.0.0.1:8000` and expects `/health` and `/v1/decisions`. Health exposes availability and device (`mps`, `mlx`, `cpu`, etc.) without exposing model files or PII.

The preferred Apple Silicon path is an isolated local environment using the official Laya runtime guidance or an MPS/MLX-compatible runtime. A local service must pass health and synthetic decision checks before it is used for benchmarks. No production process imports or depends on the local service.
