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

import {HttpClientTestingModule} from '@angular/common/http/testing';
import {ComponentFixture, TestBed} from '@angular/core/testing';

import {AppConfig} from '../../../models/app-config.model';
import {ScoreResult, Scorer, ScoringRequest} from '../../../scoring/scorer';
import {SCORERS} from '../../../scoring/scorer.registry';
import {AuthService} from '../../../services/auth.service';
import {MockAuthService} from '../../../testing/mocks';

import {ScoringSetupComponent} from './scoring-setup.component';

/**
 * A scorer whose identity, config keys, validation error and description are
 * test controlled.
 */
class FakeScorer extends Scorer {
  constructor(
      readonly id: string, readonly displayName: string,
      override readonly configKeys: ReadonlyArray<keyof AppConfig> = [],
      private readonly error?: string, override readonly description = '') {
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

describe('ScoringSetupComponent', () => {
  let fixture: ComponentFixture<ScoringSetupComponent>;
  let config: AppConfig;

  /** Renders the panel with the given scorers registered. */
  async function setUp(scorers: Scorer[], overrides: Partial<AppConfig> = {}) {
    config = {...BASE_CONFIG, ...overrides};

    await TestBed
        .configureTestingModule({
          imports: [ScoringSetupComponent, HttpClientTestingModule],
          providers: [
            {provide: AuthService, useValue: new MockAuthService()},
            {provide: SCORERS, useValue: scorers},
          ]
        })
        .compileComponents();

    fixture = TestBed.createComponent(ScoringSetupComponent);
    fixture.componentRef.setInput('config', config);
    fixture.detectChanges();
  }

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  /** The scorer checkboxes currently rendered, in DOM order. */
  function checkboxes(): HTMLInputElement[] {
    return Array.from(
        fixture.nativeElement.querySelectorAll(
            'input[type="checkbox"][aria-label]') as
        NodeListOf<HTMLInputElement>);
  }

  /** The auto rater location input, or null while no selected scorer needs it. */
  function locationSelect(): HTMLSelectElement|null {
    return fixture.nativeElement.querySelector(
        '[aria-label="Auto Rater Location"]');
  }

  /** The auto rater model input, or null while no selected scorer needs it. */
  function modelSelect(): HTMLSelectElement|null {
    return fixture.nativeElement.querySelector(
        '[aria-label="Auto Rater Model"]');
  }

  /**
   * The polite live region holding the validation message. It stays rendered
   * while the setup is valid, so that screen readers announce new messages.
   */
  function messageRegion(): HTMLElement {
    return fixture.nativeElement.querySelector('[aria-live="polite"]');
  }

  /** The inline validation message, or '' while the setup can run. */
  function validationMessage(): string {
    return messageRegion().textContent?.trim() ?? '';
  }

  it('should hide the picker when only one scorer is registered', async () => {
    await setUp([new FakeScorer('only', 'Only')]);

    expect(checkboxes().length).toBe(0);
  });

  it('should render a checkbox per scorer when several are registered',
     async () => {
       await setUp([new FakeScorer('a', 'A'), new FakeScorer('b', 'B')]);

       expect(checkboxes().map(input => input.getAttribute('aria-label')))
           .toEqual(['A', 'B']);
       // Only the default is checked out of the box.
       expect(checkboxes().map(input => input.checked)).toEqual([true, false]);
     });

  it('should describe each checkbox with its scorer\'s description',
     async () => {
       await setUp([
         new FakeScorer('a', 'A', [], undefined, 'Rates with A.'),
         new FakeScorer('b', 'B')
       ]);
       const [described, plain] = checkboxes();

       // The name stays short; the description is read after it.
       expect(described.getAttribute('aria-label')).toBe('A');
       const description = fixture.nativeElement.querySelector(
           `#${described.getAttribute('aria-describedby')}`);
       expect(description?.textContent?.trim()).toBe('Rates with A.');
       expect(plain.hasAttribute('aria-describedby')).toBeFalse();
     });

  it('should add a scorer to the selection when its checkbox is clicked',
     async () => {
       await setUp([new FakeScorer('a', 'A'), new FakeScorer('b', 'B')]);

       checkboxes()[1].click();
       fixture.detectChanges();

       expect(config.selectedScorers).toEqual(['a', 'b']);
       expect(checkboxes().map(input => input.checked)).toEqual([true, true]);
     });

  it('should remove a scorer from the selection when unchecked', async () => {
    await setUp(
        [new FakeScorer('a', 'A'), new FakeScorer('b', 'B')],
        {selectedScorers: ['a', 'b']});

    checkboxes()[0].click();
    fixture.detectChanges();

    expect(config.selectedScorers).toEqual(['b']);
    expect(checkboxes().map(input => input.checked)).toEqual([false, true]);
  });

  it('should report every edit to the parent', async () => {
    await setUp([new FakeScorer('a', 'A'), new FakeScorer('b', 'B')]);
    const changes: AppConfig[] = [];
    fixture.componentInstance.configChange.subscribe(c => void changes.push(c));

    checkboxes()[1].click();
    fixture.detectChanges();

    expect(changes).toEqual([config]);
  });

  it('should leave the incoming config untouched and ignore unknown ids',
     async () => {
       await setUp(
           [new FakeScorer('a', 'A'), new FakeScorer('b', 'B')],
           {selectedScorers: ['ghost', 'b']});
       const changes: AppConfig[] = [];
       fixture.componentInstance.configChange.subscribe(
           c => void changes.push(c));

       fixture.detectChanges();

       // Reconciling the stored selection is the host's job, so the panel
       // neither rewrites the config nor reports a change the user did not
       // make. The unknown id simply does not resolve to a checkbox.
       expect(config.selectedScorers).toEqual(['ghost', 'b']);
       expect(changes).toEqual([]);
       expect(checkboxes().map(input => input.checked)).toEqual([false, true]);
     });

  it('should show a configuration the host replaces', async () => {
    await setUp([new FakeScorer('a', 'A'), new FakeScorer('b', 'B')]);

    // Under OnPush, a host shows its own changes by passing a new object.
    fixture.componentRef.setInput(
        'config', {...config, selectedScorers: ['b']});
    fixture.detectChanges();

    expect(checkboxes().map(input => input.checked)).toEqual([false, true]);
  });

  it('should flag an empty selection', async () => {
    await setUp(
        [new FakeScorer('a', 'A'), new FakeScorer('b', 'B')],
        {selectedScorers: []});

    expect(validationMessage()).toBe('Select at least one scoring method.');
    // The message is tied to the checkboxes it is about, and announced
    // politely rather than as an alert that interrupts the user.
    for (const input of checkboxes()) {
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(input.getAttribute('aria-describedby')?.split(' '))
          .toContain(messageRegion().id);
    }
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });

  it('should show the validation error of a selected scorer', async () => {
    await setUp([
      new FakeScorer('a', 'A'),
      new FakeScorer('b', 'B', ['autoRaterModel'], 'Pick a model for B.')
    ]);
    expect(validationMessage()).toBe('');

    checkboxes()[1].click();
    fixture.detectChanges();

    expect(validationMessage()).toBe('Pick a model for B.');
    // Tied to the inputs of the scorer that reported it.
    expect(modelSelect()?.getAttribute('aria-describedby'))
        .toBe(messageRegion().id);
    expect(checkboxes().some(input => input.hasAttribute('aria-invalid')))
        .toBeFalse();
  });

  it('should render a config input only while a selected scorer needs it',
     async () => {
       await setUp([
         new FakeScorer('a', 'A'),
         new FakeScorer('b', 'B', ['autoRaterLocation', 'autoRaterModel'])
       ]);
       expect(locationSelect()).toBeNull();
       expect(modelSelect()).toBeNull();

       checkboxes()[1].click();
       fixture.detectChanges();

       expect(locationSelect()).not.toBeNull();
       expect(modelSelect()).not.toBeNull();
     });

  it('should filter offered auto rater models for multi-regional locations without mutating config on render',
     async () => {
       await setUp(
           [new FakeScorer(
               'auto', 'Auto', ['autoRaterLocation', 'autoRaterModel'])],
           {region: 'eu', autoRaterModel: 'gemini-3.1-pro-preview'});

       expect(config.autoRaterLocation).toBeUndefined();
       expect(config.autoRaterModel).toBe('gemini-3.1-pro-preview');
       expect(fixture.componentInstance.autoRaterLocation).toBe('eu');
       const options =
           Array.from(modelSelect()!.options).map(o => o.value);
       expect(options).toEqual(['gemini-3.5-flash']);
     });

  it('should update autoRaterLocation and reconcile autoRaterModel when changed by the user',
     async () => {
       await setUp(
           [new FakeScorer(
               'auto', 'Auto', ['autoRaterLocation', 'autoRaterModel'])],
           {
             region: 'global',
             autoRaterLocation: 'global',
             autoRaterModel: 'gemini-3.1-pro-preview',
           });
       const changes: AppConfig[] = [];
       fixture.componentInstance.configChange.subscribe(
           c => void changes.push(c));

       fixture.componentInstance.onAutoRaterLocationChange('eu');
       fixture.detectChanges();

       expect(config.autoRaterLocation).toBe('eu');
       expect(config.autoRaterModel).toBe('gemini-3.5-flash');
       expect(fixture.componentInstance.autoRaterModels).toEqual([
         'gemini-3.5-flash'
       ]);
       expect(changes).toEqual([config]);
     });
});
