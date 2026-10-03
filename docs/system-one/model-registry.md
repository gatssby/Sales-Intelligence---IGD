# Model registry

`model_registry_versions` separates a generic Model Asset from the IGD Client Profile.

Required fields:

- asset name (`sales-decision`), version and base model;
- dataset version/hash and trained timestamp;
- decision schemas, metrics and calibration;
- status (`candidate`, `validated`, `retired`);
- track (`champion`, `challenger`, `candidate`);
- deployment state (`not_deployed`, `local_only`, `staged`, `active`).

The registry does not auto-deploy or imply that a candidate is production-safe.
