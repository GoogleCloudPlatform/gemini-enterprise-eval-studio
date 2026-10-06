# Scoring

Every evaluated row is scored by a **scorer**: a strategy that turns a query,
the agent's response and (optionally) a golden answer into a normalized score
between `0.0` and `1.0`.

| File | Role |
| --- | --- |
| `scorer.ts` | The `Scorer` contract plus the `ScoringRequest` / `ScoreResult` shapes. |
| `scorer.registry.ts` | The `SCORERS` token listing every available scorer, and `ScorerRegistry` for looking them up. |
| `scorer-selection.ts` | `ScorerSelection`, which reads and edits the selection held in `AppConfig`. |
| `scorers/` | The scorer implementations. |

`EvalService` never talks to a scorer directly; it resolves the one named by
`AppConfig.selectedScorers` through `ScorerRegistry` and delegates to it.

The scoring controls themselves live in a single component,
`components/shared/scoring-setup`, which is rendered both by the configuration
form and by the re-rate dialog on the results step. Anything a scorer
contributes therefore shows up in both places automatically.

## Adding a scorer

1. **Implement `Scorer`** in `scorers/`, as a root-provided Angular service so
   it can inject whatever it needs:

   ```ts
   @Injectable({providedIn: 'root'})
   export class ExactMatchScorer extends Scorer {
     readonly id = 'exact-match';
     readonly displayName = 'Exact Match';
     override readonly description = 'Scores 1.0 when the response equals the golden answer.';

     async score({response, golden}: ScoringRequest): Promise<ScoreResult> {
       return {score: response.trim() === golden?.trim() ? 1 : 0};
     }
   }
   ```

2. **Register it** by adding one line to the `SCORERS` factory in
   `scorer.registry.ts`:

   ```ts
   factory: () => [
     inject(AutoRaterScorer),
     inject(ExactMatchScorer),
   ],
   ```

That is all that is required. The scoring setup picks the new scorer up
automatically: the **Scoring Methods** list appears as soon as more than one
scorer is registered, and the first entry in the list is the default. The
factory must return at least one scorer; an empty list fails to compile. At
least one scoring method must stay selected; clearing them all surfaces an
inline error and disables the **Next** button (and the **Re-rate** button in
the re-rate dialog).

## Calling a model

Scorers that call a model must go through `EvalBackendService.callScore()`
rather than `fetch()`ing the API themselves. The app is deployed both with the
user's own access token and behind a proxy that holds the credentials
server-side, and only the backend service knows which of the two is in play.

## Optional hooks

Override these on your scorer when the defaults do not fit:

- `requiresGolden` — set to `false` for reference-free scorers (safety,
  groundedness, …). Rows without a golden answer are skipped when it is `true`.
- `configKeys` — the `AppConfig` keys your scorer reads. The scoring setup
  renders only the inputs belonging to the selected scorer, so a new setting
  needs a field on `AppConfig`, an input in `scoring-setup.component.html`
  guarded by `usesConfigKey('yourKey')`, and the key listed here.
- `validate(config)` — return an error message when the scorer cannot run with
  the current configuration; the wizard blocks the **Next** button while one is
  returned. Return only the first problem found, so the user fixes one at a
  time.

Throw an `Error` with a user facing message from `score()` when scoring fails.
The caller records it as the `error` of the scorer's entry in the row's
`scorerResults` and keeps the fetched response.
