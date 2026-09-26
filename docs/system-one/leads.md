# Lead decisions

The first System One lead profile is intentionally small:

- commercial fit;
- contact priority;
- intent;
- response probability;
- immediate-contact decision;
- temperature;
- routing/queue.

Each `decision_run` stores the structured input snapshot used for the decision. Later outcomes (`responded`, `booked`, `showed_up`, `purchased`) are labels with provenance and observation windows; future model predictions are not labels.
