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

import {Injectable} from '@angular/core';

import {AppConfig} from '../models/app-config.model';

import {Scorer} from './scorer';
import {ScorerRegistry} from './scorer.registry';

/**
 * Reads and edits the scoring method selection held in an `AppConfig`.
 *
 * The scoring setup is offered in two places — the configuration form and the
 * re-rate dialog — through the shared `ScoringSetupComponent`. This service
 * holds the behaviour behind those controls so both offer the same methods,
 * the same method specific inputs and the same validation.
 *
 * Every mutating method edits the given configuration in place and leaves
 * persistence to the caller, so the wizard can save each keystroke while the
 * re-rate dialog can discard its draft on cancel.
 */
@Injectable({providedIn: 'root'})
export class ScorerSelection {
  constructor(private readonly registry: ScorerRegistry) {}

  /** Every registered scoring method, in display order. */
  get available(): readonly Scorer[] {
    return this.registry.list();
  }

  /**
   * Whether there is a choice worth offering. With a single registered method
   * the picker is hidden, as there is nothing to pick.
   */
  get hasChoice(): boolean {
    return this.available.length > 1;
  }

  /**
   * Reconciles the configured selection with the registry, rewriting it to
   * exactly what will run: unknown ids and duplicates are dropped and the rest
   * are stored in registry order.
   *
   * An absent selection, or one naming only unknown ids (e.g. a stale id left
   * behind after a scorer was renamed or removed), adopts the default so the
   * user starts from a working configuration. A selection the user cleared is
   * kept empty so `validate` flags it, unless the picker is hidden because
   * only one method is registered and there would be no way to recover.
   *
   * @param config The configuration to reconcile, edited in place.
   * @returns Whether the selection changed and is worth persisting.
   */
  normalize(config: AppConfig): boolean {
    const configured = config.selectedScorers;
    const resolved = this.selected(config).map(s => s.id);
    const normalized = resolved.length === 0 && !this.hasChoice ?
        this.registry.defaultIds :
        resolved;
    if (configured && normalized.length === configured.length &&
        normalized.every((id, i) => id === configured[i])) {
      return false;
    }
    config.selectedScorers = normalized;
    return true;
  }

  /**
   * The scoring methods that will run, in run order.
   * @param config The configuration to read.
   * @returns The selected methods, as resolved by `ScorerRegistry.resolveAll`:
   *     an explicitly cleared selection stays empty, while an absent one, or
   *     one naming only unknown methods, falls back to the registry default.
   */
  selected(config: AppConfig): readonly Scorer[] {
    return this.registry.resolveAll(config.selectedScorers);
  }

  /** Checks whether a scoring method is part of the current selection. */
  isSelected(config: AppConfig, scorer: Scorer): boolean {
    return this.selected(config).some(s => s.id === scorer.id);
  }

  /**
   * Adds or removes a scoring method from the selection. Removing the last one
   * is allowed; `validate` then blocks the run until one is picked again. The
   * ids are stored in registry order, which is the order the methods run in.
   * @param config The configuration to edit in place.
   * @param scorer The method to add or remove.
   */
  toggle(config: AppConfig, scorer: Scorer) {
    const ids = new Set(this.selected(config).map(s => s.id));
    if (ids.has(scorer.id)) {
      ids.delete(scorer.id);
    } else {
      ids.add(scorer.id);
    }
    config.selectedScorers =
        this.available.filter(s => ids.has(s.id)).map(s => s.id);
  }

  /** Summarizes the selection for the caption under the picker. */
  summarize(config: AppConfig): string {
    const selected = this.selected(config);
    if (selected.length === 0) {
      return 'No Scorers Selected';
    }
    if (selected.length === 1) {
      return selected[0].displayName;
    }
    return `${selected.length} Scorers Selected`;
  }

  /**
   * Checks whether any selected method reads the given configuration key, so
   * that only the inputs the run needs are rendered.
   */
  usesConfigKey(config: AppConfig, key: keyof AppConfig): boolean {
    return this.selected(config).some(
        scorer => scorer.configKeys.includes(key));
  }

  /**
   * Validates the scoring setup against the configuration.
   * @param config The configuration to validate.
   * @returns The first error message, or undefined when the selection can run.
   *     A run needs at least one scoring method, so an empty selection is an
   *     error.
   */
  validate(config: AppConfig): string|undefined {
    const selected = this.selected(config);
    if (selected.length === 0) {
      return 'Select at least one scoring method.';
    }
    for (const scorer of selected) {
      const error = scorer.validate(config);
      if (error) {
        return error;
      }
    }
    return undefined;
  }
}
