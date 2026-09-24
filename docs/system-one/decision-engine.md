# Decision Engine

`@igd/decision-engine` is the deep module at the provider seam.

The interface accepts a typed subject (`lead`, `call` or `batch`) and an input snapshot, and returns:

- typed decisions (`choice`, boolean/noul or score);
- confidence and probabilities;
- evidence metadata and optional timestamp/speaker;
- provider, model and model version;
- schema version;
- latency, usage and cost when available.

The engine owns response validation, retryable failure handling, provider health and append-only local persistence. The domain does not import Jev or Laya directly.

Provider errors are sanitized. API keys are read from environment/local secret storage and never logged or committed.
