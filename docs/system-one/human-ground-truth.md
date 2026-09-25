# System One human ground truth v0.1

This workflow creates independent human labels for the 30-call private pilot. Predictions are never labels, and the first review pass never exposes Laya output, confidence, probabilities, review state or disagreement.

## Label contract

Contract version: `system-one-human-labels-v0.1`.

Each reviewed item contains only `call_id`, `decision_key`, `human_value`, `reviewer`, `reviewed_at` and optional `notes`. `reviewed_at` distinguishes an intentional `null` from an unanswered item.

Use `null` when the full call does not provide enough evidence to choose a value confidently. Do not infer from seller identity, expected outcome, Laya predictions or external customer information. Notes must summarize the labeling rationale without copying transcript text.

### Boolean decisions

Allowed values: `true`, `false`, `null`.

| Decision | `true` means | Does not count |
| --- | --- | --- |
| `pain_identified` | The buyer explicitly states or clearly confirms a problem, need or undesirable current state. | A generic sales claim, seller assumption or product feature without buyer confirmation. |
| `impact_explored` | The call explicitly explores a consequence of the pain: operational, financial, strategic, emotional or temporal. | Merely repeating the pain or naming a benefit without connecting it to buyer impact. |
| `price_objection_present` | The buyer explicitly resists price, budget, affordability or payment terms. | A neutral request for price or the seller volunteering a discount. |
| `objection_handled` | The seller directly acknowledges and responds to an explicit objection. | Ignoring, deflecting or changing topic without addressing the objection. |
| `social_proof_used` | The seller uses a customer example, case, result, testimonial or relevant peer comparison as support. | Unsupported claims such as “many customers like it.” |
| `urgency_present` | The buyer or seller establishes a concrete reason that timing matters. | Generic pressure, artificial scarcity without context or a routine follow-up date alone. |
| `cta_present` | The seller makes an explicit request for an action or commitment. | A vague closing remark with no requested action. |
| `next_step_defined` | A concrete next action is agreed or clearly assigned, ideally with owner or timing. | “We will talk later” without a defined action. |

Synthetic example: if a buyer says a manual process delays weekly reporting and the seller asks what that delay costs, `pain_identified=true` and `impact_explored=true`. If the seller merely says the product saves time, neither follows automatically.

### Objection type

Allowed values: `none`, `price`, `timing`, `authority`, `trust`, `fit`, `other`, or `null`.

Preserve the v0.1 single-choice contract for baseline comparability. Choose the principal explicit objection for the whole call. Use `none` when there is no explicit objection, `other` only when an explicit objection does not fit the named classes, and `null` when multiple objections prevent a defensible single choice or the transcript is insufficient.

Synthetic examples: “we do not have budget” → `price`; “I need approval from procurement” → `authority`; a neutral pricing question is not automatically `price`.

### Buyer intent

Allowed values: any finite number from 1 through 5, including fractional values, or `null`. Evaluate the full call without seeing Laya output. The continuous range is intentional because the V0.1 call-level aggregate may also be fractional; it is not silently rounded before benchmarking.

- `1`: explicit rejection or no credible willingness to continue.
- `2`: weak interest; major unresolved barriers; no meaningful commitment.
- `3`: mixed or exploratory interest; possible continuation without strong commitment.
- `4`: clear positive intent with a credible next step or buying signal.
- `5`: explicit high commitment, purchase decision or immediate execution step.

Use `null` when the call does not contain enough buyer-side evidence. Do not score seller enthusiasm as buyer intent.

## Prepare private files

```bash
npm run system-one:labels:prepare
```

This creates, without overwriting existing files:

- `private/system-one/pilot-30-human-labels.json` — 300 blank labels for reviewer one;
- `private/system-one/pilot-30-double-review-template.json` — 50 blank labels covering five deterministically spread calls.

Both remain `0600` under the ignored `private/system-one/` directory (`0700`).

## Run the blind local reviewer

Open the SSH tunnel separately, provide the existing read-only URL through the environment, then run:

```bash
npm run system-one:review -- --reviewer=<reviewer-code>
```

The server binds only to `127.0.0.1:4317`. It validates the connected socket plus Host/Origin localhost boundaries. It accepts only the dedicated loopback PostgreSQL tunnel on port `5433` and verifies `system_one_pilot_ro`, transaction read-only settings, inherited roles, schema/table/column write privileges, and the exact transcript columns required by the query. It loads one latest transcript at a time and writes only labels. It has no provider adapter and no predictions input.

Every CLI input and output path is confined to the canonical `private/system-one/` directory. Symlink and traversal escapes fail closed.

For reviewer two, point the server at the double-review template and a new private labels path. The server creates that labels file exclusively if it does not exist:

```bash
npm run system-one:review -- \
  --reviewer=<second-reviewer-code> \
  --template=private/system-one/pilot-30-double-review-template.json \
  --labels=private/system-one/pilot-30-double-review-labels.json \
  --port=4318
```

Reviewer two must not receive reviewer-one labels or prediction files.

## Agreement

After both five-call reviews are complete:

```bash
npm run system-one:agreement:human -- \
  --first=private/system-one/pilot-30-double-review-labels-reviewer-a.json \
  --second=private/system-one/pilot-30-double-review-labels-reviewer-b.json
```

Categorical decisions report raw agreement and Cohen’s kappa when defined. `buyer_intent` reports exact agreement, agreement within ±1 and MAE. No agreement value is generated before both reviews are complete.

## Benchmark

After all 300 primary entries have a `reviewed_at` value:

```bash
npm run system-one:benchmark:human
```

The benchmark fails closed unless the manifest, labels and predictions form the exact unique 30 calls × 10 decisions universe. It validates value types, confidence bounds, chunk counts and probability maps before computing any metric. Human `null` remains a valid reviewed abstention when `reviewed_at` is present.

Outputs:

- private reconciliation report: `private/system-one/pilot-30-laya-benchmark.json`;
- aggregate sanitized summary: `private/system-one/pilot-30-laya-benchmark-summary.json`.

Metrics are reported per decision key. There is no overall winner score. Operational completion and predictive quality remain separate concepts.
