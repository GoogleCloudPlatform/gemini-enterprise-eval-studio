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
import {EvalBackendService} from '../services/eval-backend.service';
import {MockEvalBackendService} from '../testing/mocks';

import {ScoreResult, Scorer, ScoringRequest} from './scorer';
import {SCORERS, ScorerRegistry} from './scorer.registry';
import {AUTO_RATER_SCORER_ID} from './scorers/auto-rater.scorer';
import {LCS_SCORER_ID} from './scorers/lcs.scorer';

/** Minimal scorer used to verify the registry stays strategy agnostic. */
class FakeScorer extends Scorer {
  override readonly requiresGolden = false;

  constructor(
      readonly id = 'fake', readonly displayName = 'Fake Scorer') {
    super();
  }

  async score(request: ScoringRequest): Promise<ScoreResult> {
    return {score: 1};
  }
}

describe('ScorerRegistry', () => {
  describe('with the built-in scorers', () => {
    let registry: ScorerRegistry;

    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [
          {provide: EvalBackendService, useClass: MockEvalBackendService},
        ],
      });
      registry = TestBed.inject(ScorerRegistry);
    });

    it('should register the auto rater and LCS scorer in display order', () => {
      expect(registry.list().map(s => s.id)).toEqual([
        AUTO_RATER_SCORER_ID,
        LCS_SCORER_ID,
      ]);
    });

    it('should default to the first registered scorer', () => {
      expect(registry.defaultId).toBe(AUTO_RATER_SCORER_ID);
      expect(registry.defaultId).toBe(registry.list()[0].id);
    });

    it('should look up a scorer by id', () => {
      expect(registry.find(AUTO_RATER_SCORER_ID)?.id).toBe(AUTO_RATER_SCORER_ID);
      expect(registry.find(LCS_SCORER_ID)?.id).toBe(LCS_SCORER_ID);
    });

    it('should not find an unknown id', () => {
      expect(registry.find('does-not-exist')).toBeUndefined();
    });

    it('should require a golden answer for the auto rater and LCS scorer', () => {
      expect(registry.find(AUTO_RATER_SCORER_ID)?.requiresGolden).toBeTrue();
      expect(registry.find(LCS_SCORER_ID)?.requiresGolden).toBeTrue();
    });

    it('should require no config keys or model validation for the LCS scorer',
       () => {
         const lcs = registry.find(LCS_SCORER_ID)!;
         const emptyConfig: AppConfig = {
           gCloudToken: '',
           projectId: '',
           region: 'global',
           selectedEngine: '',
           selectedModel: '',
           autoRaterModel: '',
           autoRaterInstruction: '',
           selectedDataStores: [],
           enableWebSearch: false,
         };

         expect(lcs.configKeys).toEqual([]);
         expect(lcs.validate(emptyConfig)).toBeUndefined();
       });

    it('should reject an auto rater config without a model', () => {
      const config: AppConfig = {
        gCloudToken: '',
        projectId: '',
        region: 'global',
        selectedEngine: '',
        selectedModel: '',
        autoRaterModel: '',
        autoRaterInstruction: 'Rate the response against the golden answer.',
        selectedDataStores: [],
        enableWebSearch: false
      };
      const autoRater = registry.find(AUTO_RATER_SCORER_ID)!;

      expect(autoRater.validate(config)).toBeTruthy();
      expect(autoRater.validate({...config, autoRaterModel: 'gemini-3.5-flash'}))
          .toBeUndefined();
    });

    it('should default to a selection holding the default scorer', () => {
      expect(registry.defaultIds).toEqual([registry.defaultId]);
    });
  });

  describe('resolveAll', () => {
    /** Registers the given ids as scorers and returns the registry. */
    function registryOf(...ids: string[]): ScorerRegistry {
      TestBed.configureTestingModule({
        providers: [{
          provide: SCORERS,
          useValue: ids.map(id => new FakeScorer(id, id.toUpperCase()))
        }]
      });
      return TestBed.inject(ScorerRegistry);
    }

    it('should resolve every selected scorer', () => {
      const registry = registryOf('a', 'b', 'c');

      expect(registry.resolveAll(['a', 'c']).map(s => s.id)).toEqual([
        'a', 'c'
      ]);
    });

    it('should return the scorers in registry order, not selection order',
       () => {
         const registry = registryOf('a', 'b', 'c');

         expect(registry.resolveAll(['c', 'a']).map(s => s.id)).toEqual([
           'a', 'c'
         ]);
       });

    it('should drop duplicate ids', () => {
      const registry = registryOf('a', 'b');

      expect(registry.resolveAll(['a', 'a', 'b']).map(s => s.id)).toEqual([
        'a', 'b'
      ]);
    });

    it('should drop unknown ids', () => {
      const registry = registryOf('a', 'b');

      expect(registry.resolveAll(['a', 'nope']).map(s => s.id)).toEqual(['a']);
    });

    it('should fall back to the default scorer for an unset selection', () => {
      const registry = registryOf('a', 'b');

      expect(registry.resolveAll(undefined).map(s => s.id)).toEqual(['a']);
    });

    it('should resolve a cleared selection to no scorer', () => {
      const registry = registryOf('a', 'b');

      expect(registry.resolveAll([])).toEqual([]);
    });

    it('should fall back to the default scorer when every id is unknown',
       () => {
         const registry = registryOf('a', 'b');

         expect(registry.resolveAll(['nope', 'also-nope']).map(s => s.id))
             .toEqual(['a']);
       });
  });

  describe('with custom scorers', () => {
    it('should expose scorers registered through the SCORERS token', () => {
      const fake = new FakeScorer();
      TestBed.configureTestingModule(
          {providers: [{provide: SCORERS, useValue: [fake]}]});

      const registry = TestBed.inject(ScorerRegistry);

      expect(registry.list()).toEqual([fake]);
      expect(registry.defaultId).toBe('fake');
      expect(registry.find('fake')).toBe(fake);
    });
  });
});
