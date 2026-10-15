# Local Qwen analysis package

This package is intentionally isolated from System One and from production services. It provides:

- `LocalQwenProvider`: OpenAI-compatible llama.cpp client with JSON Schema response format;
- `LocalQwenPipeline`: five-pass factual, commercial, dimension, coaching, and synthesis flow;
- turn-aware chunking with overlap;
- deterministic schema and evidence validation;
- explicit day/night profiles, bounded retries, transcript hash, and pipeline provenance.

The provider endpoint defaults to `http://127.0.0.1:18081` and is never exposed by this package.

Run tests from the repository root:

```bash
PYTHONPATH=packages/ai_local python3 -m unittest discover -s packages/ai_local/tests -v
```
