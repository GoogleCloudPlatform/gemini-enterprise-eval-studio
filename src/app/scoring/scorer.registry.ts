/*
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {Inject, Injectable, InjectionToken, inject} from '@angular/core';

import {Scorer} from './scorer';
import {AutoRaterScorer} from './scorers/auto-rater.scorer';

/**
 * A non-empty list of scorers. Typed as a tuple so that registering no scorer
 * at all is caught by the compiler rather than at runtime.
 */
export type ScorerList = readonly [Scorer, ...Scorer[]];

/**
 * Every scorer available to the application, in the order they are offered in
 * the UI. The first entry is the default, and at least one is required.
 *
 * To add a scorer: implement `Scorer` as an `@Injectable({providedIn:
 * 'root'})` service and add `inject(MyScorer)` to the factory below. Nothing
 * else needs to change.
 */
export const SCORERS = new InjectionToken<ScorerList>('app.scorers', {
  providedIn: 'root',
  factory: () => [
    inject(AutoRaterScorer),
  ],
});

/**
 * Provides lookup of the registered scoring strategies.
 */
@Injectable({providedIn: 'root'})
export class ScorerRegistry {
  constructor(@Inject(SCORERS) private readonly scorers: ScorerList) {}

  /** All registered scorers, in display order. */
  list(): ScorerList {
    return this.scorers;
  }

  /** Identifier of the scorer used when the config does not name one. */
  get defaultId(): string {
    return this.scorers[0].id;
  }

  /** The selection applied when the config does not name any scorer. */
  get defaultIds(): string[] {
    return [this.defaultId];
  }

  /** Looks up a scorer by identifier. */
  find(id: string|undefined): Scorer|undefined {
    return this.scorers.find(scorer => scorer.id === id);
  }

  /**
   * Resolves every scorer named by the configuration.
   * @param ids The configured scorer ids, if any.
   * @returns The matching scorers in registry order, de-duplicated. Unknown
   *     ids are dropped with a warning; an empty selection falls back to the
   *     default scorer so a run always produces a score.
   */
  resolveAll(ids?: readonly string[]): readonly Scorer[] {
    const selected = new Set(ids?.length ? ids : this.defaultIds);
    for (const id of selected) {
      if (!this.find(id)) {
        console.warn(`Unknown scorer '${id}'. Ignoring it.`);
      }
    }
    // Iterating the registry rather than `ids` keeps the run order stable and
    // drops duplicates.
    const resolved = this.scorers.filter(scorer => selected.has(scorer.id));
    return resolved.length > 0 ? resolved : this.resolveAll(this.defaultIds);
  }
}
