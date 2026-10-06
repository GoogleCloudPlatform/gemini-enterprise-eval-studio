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

import {CommonModule} from '@angular/common';
import {ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, Output} from '@angular/core';
import {FormsModule} from '@angular/forms';

import type {AppConfig} from '../../../models/app-config.model';
import {Scorer} from '../../../scoring/scorer';
import {ScorerSelection} from '../../../scoring/scorer-selection';
import {listAutoRaterModels} from '../../../scoring/scorers/auto-rater.scorer';
import {AuthService} from '../../../services/auth.service';
import {InfoTooltipComponent} from '../info-tooltip/info-tooltip.component';

/** Keeps element ids unique when several panels are rendered at once. */
let nextPanelId = 0;

/**
 * The scoring setup controls: which scoring methods to apply, the inputs the
 * selected methods need, and the reason the setup cannot run yet.
 *
 * Used by the configuration form when setting a run up, and by the re-rate
 * dialog when re-scoring fetched responses, so both offer exactly the same
 * options.
 *
 * The panel edits `config` in place as the user works the controls and
 * reports every edit through `configChange`; persisting it is the parent's
 * call, which lets the wizard save as the user types while the dialog can drop
 * its draft on cancel. That only holds if the host passes a copy it owns, such
 * as a draft, never shared state. The panel uses `OnPush` and works out what
 * it shows when `config` is set, so a host that changes the configuration
 * itself must pass a new object rather than mutate the one the panel holds.
 *
 * Reconciling a stored selection with the registry is the host's job too,
 * through `ScorerSelection.normalize`: the panel renders whatever it is given —
 * unknown ids simply do not resolve to a scorer — and only edits the
 * configuration when the user does.
 */
@Component({
  selector: 'app-scoring-setup',
  standalone: true,
  imports: [CommonModule, FormsModule, InfoTooltipComponent],
  templateUrl: './scoring-setup.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ScoringSetupComponent implements OnChanges {
  /**
   * The configuration to edit in place: a copy the host owns. Pass a new
   * object, rather than mutating this one, to show changes made outside the
   * panel.
   */
  @Input({required: true}) config!: AppConfig;

  /** Emits `config`, edited in place, whenever the user changes something. */
  @Output() readonly configChange = new EventEmitter<AppConfig>();

  /** The auto-rater models on offer. */
  readonly autoRaterModels: readonly string[];

  /** Prefix of the ids of the elements the controls point at. */
  private readonly idPrefix = `scoring-setup-${nextPanelId++}`;

  /** Id of the validation message, which the controls it is about point at. */
  readonly errorId = `${this.idPrefix}-error`;

  /** The scoring methods that will run, in run order. */
  selectedScorers: readonly Scorer[] = [];

  /** Summarizes the selection for the caption under the picker. */
  selectionSummary = '';

  /** The reason the scoring setup cannot run, if any. */
  validationError: string|undefined;

  /** The config keys of the scorer the validation message comes from. */
  private errorConfigKeys: ReadonlyArray<keyof AppConfig> = [];

  constructor(
      private readonly selection: ScorerSelection,
      authService: AuthService,
  ) {
    this.autoRaterModels = listAutoRaterModels(authService.showCredentialInputs);
  }

  /** Every registered scoring method, in display order. */
  get scorers(): readonly Scorer[] {
    return this.selection.available;
  }

  /** Whether the picker has more than one method to choose between. */
  get showPicker(): boolean {
    return this.selection.hasChoice;
  }

  ngOnChanges() {
    this.refresh();
  }

  /** Checks whether a scoring method is part of the current selection. */
  isScorerSelected(scorer: Scorer): boolean {
    return this.selectedScorers.some(s => s.id === scorer.id);
  }

  /** Adds or removes a scoring method from the selection. */
  toggleScorer(scorer: Scorer) {
    this.selection.toggle(this.config, scorer);
    this.onConfigChange();
  }

  /**
   * Checks whether any selected method reads the given configuration key, so
   * that only the inputs the run needs are rendered.
   */
  usesConfigKey(key: keyof AppConfig): boolean {
    return this.selectedScorers.some(scorer => scorer.configKeys.includes(key));
  }

  /** Id of the element holding the description of the scorer at an index. */
  descriptionId(index: number): string {
    return `${this.idPrefix}-description-${index}`;
  }

  /**
   * The ids of the elements describing a scorer's checkbox: the scorer's
   * description, and the validation message while nothing is selected.
   */
  checkboxDescribedBy(scorer: Scorer, index: number): string|null {
    const ids: string[] = [];
    if (scorer.description) {
      ids.push(this.descriptionId(index));
    }
    if (this.selectedScorers.length === 0) {
      ids.push(this.errorId);
    }
    return ids.length > 0 ? ids.join(' ') : null;
  }

  /**
   * Points the input for a configuration key at the validation message when
   * the message comes from a scorer that reads that key.
   */
  inputDescribedBy(key: keyof AppConfig): string|null {
    return this.errorConfigKeys.includes(key) ? this.errorId : null;
  }

  /** Reports an edit made through one of the controls. */
  onConfigChange() {
    this.refresh();
    this.configChange.emit(this.config);
  }

  /**
   * Works out everything the template shows from `config` at once, so that
   * rendering only reads fields. Runs when the host passes a configuration and
   * after every edit made through the panel.
   */
  private refresh() {
    this.selectedScorers = this.selection.selected(this.config);
    this.selectionSummary = this.selection.summarize(this.config);
    this.validationError = this.selection.validate(this.config);
    // `validate` reports the first selected scorer that rejects the
    // configuration. Scorers return a message without saying which of their
    // inputs is at fault, so the message is tied to all of that scorer's.
    const rejecting = this.selectedScorers.find(s => s.validate(this.config));
    this.errorConfigKeys = rejecting?.configKeys ?? [];
  }
}
