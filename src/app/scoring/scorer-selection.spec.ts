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

import {TestBed} from '@angular/core/testing';

import {AppConfig} from '../models/app-config.model';

import {ScoreResult, Scorer, ScoringRequest} from './scorer';
import {SCORERS} from './scorer.registry';
import {ScorerSelection} from './scorer-selection';

/** A scorer whose identity, config keys and validation are test controlled. */
class FakeScorer extends Scorer {
  constructor(
      readonly id: string, readonly displayName: string,
      override readonly configKeys: ReadonlyArray<keyof AppConfig> = [],
      private readonly error: string|undefined = undefined) {
    super();
  }

  async score(request: ScoringRequest): Promise<ScoreResult> {
    return {score: 1};
  }

  override validate(config: AppConfig): string|undefined {
    return this.error;
  }
}

const BASE_CONFIG: AppConfig = {
  gCloudToken: '',
  projectId: '',
  region: 'global',
  selectedEngine: '',
  selectedModel: '',
  autoRaterModel: '',
  autoRaterInstruction: '',
  selectedDataStores: [],
  enableWebSearch: false
};

describe('ScorerSelection', () => {
  /** Builds the service with the given scorers registered. */
  function selectionOf(...scorers: Scorer[]): ScorerSelection {
    TestBed.configureTestingModule(
        {providers: [{provide: SCORERS, useValue: scorers}]});
    return TestBed.inject(ScorerSelection);
  }

  /** A config naming the given scorers, or none when omitted. */
  function configOf(selectedScorers?: string[]): AppConfig {
    return selectedScorers ? {...BASE_CONFIG, selectedScorers} :
                             {...BASE_CONFIG};
  }

  /** Two interchangeable scorers, for the cases that just need a choice. */
  function twoScorers(): ScorerSelection {
    return selectionOf(new FakeScorer('a', 'A'), new FakeScorer('b', 'B'));
  }

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  describe('available methods', () => {
    it('should list the registered scorers in order', () => {
      expect(twoScorers().available.map(s => s.id)).toEqual(['a', 'b']);
    });

    it('should offer no choice when a single scorer is registered', () => {
      expect(selectionOf(new FakeScorer('only', 'Only')).hasChoice).toBeFalse();
    });

    it('should offer a choice when several scorers are registered', () => {
      expect(twoScorers().hasChoice).toBeTrue();
    });
  });

  describe('normalize', () => {
    it('should adopt the default when the config names no scorer', () => {
      const selection = twoScorers();
      const config = configOf();

      expect(selection.normalize(config)).toBeTrue();
      expect(config.selectedScorers).toEqual(['a']);
    });

    it('should drop unknown ids', () => {
      const selection = twoScorers();
      const config = configOf(['ghost', 'b']);

      expect(selection.normalize(config)).toBeTrue();
      expect(config.selectedScorers).toEqual(['b']);
    });

    it('should adopt the default when every configured id is unknown', () => {
      const selection = twoScorers();
      const config = configOf(['ghost']);

      expect(selection.normalize(config)).toBeTrue();
      expect(config.selectedScorers).toEqual(['a']);
    });

    it('should store the selection in registry order without duplicates',
       () => {
         const selection = selectionOf(
             new FakeScorer('c', 'C'), new FakeScorer('a', 'A'),
             new FakeScorer('b', 'B'));
         const config = configOf(['b', 'c', 'b']);

         expect(selection.normalize(config)).toBeTrue();
         expect(config.selectedScorers).toEqual(['c', 'b']);
       });

    it('should report no change for an already valid selection', () => {
      const selection = twoScorers();
      const config = configOf(['a', 'b']);

      expect(selection.normalize(config)).toBeFalse();
      expect(config.selectedScorers).toEqual(['a', 'b']);
    });

    it('should keep a cleared selection while the picker is shown', () => {
      const selection = twoScorers();
      const config = configOf([]);

      expect(selection.normalize(config)).toBeFalse();
      expect(config.selectedScorers).toEqual([]);
    });

    it('should restore the default when the picker is hidden', () => {
      const selection = selectionOf(new FakeScorer('only', 'Only'));
      const config = configOf([]);

      expect(selection.normalize(config)).toBeTrue();
      expect(config.selectedScorers).toEqual(['only']);
    });
  });

  describe('selected', () => {
    it('should fall back to the default when the config names no scorer', () => {
      expect(twoScorers().selected(configOf()).map(s => s.id)).toEqual(['a']);
    });

    it('should stay empty for a selection the user cleared', () => {
      expect(twoScorers().selected(configOf([]))).toEqual([]);
    });

    it('should report whether a scorer is selected', () => {
      const a = new FakeScorer('a', 'A');
      const b = new FakeScorer('b', 'B');
      const selection = selectionOf(a, b);
      const config = configOf(['a']);

      expect(selection.isSelected(config, a)).toBeTrue();
      expect(selection.isSelected(config, b)).toBeFalse();
    });
  });

  describe('toggle', () => {
    it('should add an unselected scorer', () => {
      const b = new FakeScorer('b', 'B');
      const selection = selectionOf(new FakeScorer('a', 'A'), b);
      const config = configOf(['a']);

      selection.toggle(config, b);

      expect(config.selectedScorers).toEqual(['a', 'b']);
    });

    it('should store an added scorer in registry order', () => {
      const c = new FakeScorer('c', 'C');
      const selection =
          selectionOf(c, new FakeScorer('a', 'A'), new FakeScorer('b', 'B'));
      const config = configOf(['b']);

      selection.toggle(config, c);

      expect(config.selectedScorers).toEqual(['c', 'b']);
    });

    it('should remove a selected scorer', () => {
      const a = new FakeScorer('a', 'A');
      const selection = selectionOf(a, new FakeScorer('b', 'B'));
      const config = configOf(['a', 'b']);

      selection.toggle(config, a);

      expect(config.selectedScorers).toEqual(['b']);
    });

    it('should allow clearing the last scorer', () => {
      const a = new FakeScorer('a', 'A');
      const selection = selectionOf(a, new FakeScorer('b', 'B'));
      const config = configOf(['a']);

      selection.toggle(config, a);

      expect(config.selectedScorers).toEqual([]);
    });
  });

  describe('summarize', () => {
    it('should name the only selected scorer', () => {
      expect(twoScorers().summarize(configOf(['a']))).toBe('A');
    });

    it('should count several selected scorers', () => {
      expect(twoScorers().summarize(configOf(['a', 'b'])))
          .toBe('2 Scorers Selected');
    });

    it('should flag an empty selection', () => {
      expect(twoScorers().summarize(configOf([]))).toBe('No Scorers Selected');
    });
  });

  describe('usesConfigKey', () => {
    it('should report a key only while a selected scorer reads it', () => {
      const b = new FakeScorer('b', 'B', ['autoRaterModel']);
      const selection = selectionOf(new FakeScorer('a', 'A'), b);
      const config = configOf(['a']);

      expect(selection.usesConfigKey(config, 'autoRaterModel')).toBeFalse();

      selection.toggle(config, b);

      expect(selection.usesConfigKey(config, 'autoRaterModel')).toBeTrue();
    });
  });

  describe('validate', () => {
    it('should reject an empty selection', () => {
      expect(twoScorers().validate(configOf([])))
          .toBe('Select at least one scoring method.');
    });

    it('should surface the first error across the selected scorers', () => {
      const selection = selectionOf(
          new FakeScorer('a', 'A'), new FakeScorer('b', 'B', [], 'B is off'));

      expect(selection.validate(configOf(['a', 'b']))).toBe('B is off');
    });

    it('should accept a selection whose scorers are all happy', () => {
      expect(twoScorers().validate(configOf(['a', 'b']))).toBeUndefined();
    });
  });
});
