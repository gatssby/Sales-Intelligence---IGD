# Jev champion

Jev is the initial champion/baseline. The client runs locally in this repository and calls a remote Jev API through `JevDecisionEngine`.

Configuration is local only:

```text
JEV_API_KEY=
JEV_BASE_URL=
JEV_MODEL=jev-latest
JEV_MODEL_VERSION=
```

When `JEV_API_KEY` is absent, the adapter remains testable through injected fetch/mocks and reports `missing_api_key`; it does not fabricate a result. No live test is run in this phase.

The request/response seam follows Jev System One's typed-decision API: `POST https://thejevai.com/v1/systemone` with `model`, `state` and `questions`, returning typed `answers`. See the official Jev API documentation before enabling a live integration.
