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
import {BehaviorSubject} from 'rxjs';

import {AppConfig, Engine} from '../../../models/app-config.model';
import {ScoreResult, Scorer, ScoringRequest} from '../../../scoring/scorer';
import {SCORERS} from '../../../scoring/scorer.registry';
import {AuthService} from '../../../services/auth.service';
import {EvalBackendService} from '../../../services/eval-backend.service';
import {StateService} from '../../../services/state.service';
import {MockAuthService, MockEvalBackendService} from '../../../testing/mocks';

import {ConfigFormComponent} from './config-form.component';

/**
 * Covers how the form wires the shared scoring setup into the wizard: the
 * selection it persists and the gate it puts on **Next**. The panel's own
 * behaviour is covered by `scoring-setup.component_test.ts`, and the selection
 * rules by `scorer-selection_test.ts`.
 */

/** A scorer whose identity and validation are test controlled. */
class FakeScorer extends Scorer {
  constructor(
      readonly id: string, readonly displayName: string,
      private readonly error?: string) {
    super();
  }

  async score(request: ScoringRequest): Promise<ScoreResult> {
    return {score: 1};
  }

  override validate(config: AppConfig): string|undefined {
    return this.error;
  }
}

/**
 * A fresh configuration. `selectedScorers` is deliberately unset, as in the
 * app's default configuration, so the registry default applies; an empty list
 * would mean the user cleared the selection, which tests opt into explicitly.
 */
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

describe('ConfigFormComponent multi-scorer selection', () => {
  let fixture: ComponentFixture<ConfigFormComponent>;
  let component: ConfigFormComponent;
  let mockStateService: jasmine.SpyObj<StateService>;
  let configSubject: BehaviorSubject<AppConfig>;

  /**
   * Builds the component with the given scorers registered. With
   * `feedConfigBack`, `setConfig` pushes into `config$` synchronously, as the
   * real `StateService` does.
   */
  async function setUp(
      scorers: Scorer[], config: Partial<AppConfig> = {},
      {feedConfigBack = false} = {}) {
    configSubject = new BehaviorSubject<AppConfig>({...BASE_CONFIG, ...config});
    mockStateService = jasmine.createSpyObj(
        'StateService',
        ['setConfig', 'setEngines', 'getCurrentConfig', 'setErrorMessage'], {
          config$: configSubject.asObservable(),
          engines$: new BehaviorSubject<Engine[]>([]).asObservable(),
          errorMessage$: new BehaviorSubject<string>('').asObservable()
        });
    mockStateService.getCurrentConfig.and.callFake(() => configSubject.value);
    if (feedConfigBack) {
      mockStateService.setConfig.and.callFake(
          (c: AppConfig) => void configSubject.next(structuredClone(c)));
    }

    await TestBed
        .configureTestingModule({
          imports: [ConfigFormComponent, HttpClientTestingModule],
          providers: [
            {provide: StateService, useValue: mockStateService},
            {provide: AuthService, useValue: new MockAuthService()},
            {provide: EvalBackendService, useValue: new MockEvalBackendService()},
            {provide: SCORERS, useValue: scorers},
          ]
        })
        .compileComponents();

    fixture = TestBed.createComponent(ConfigFormComponent);
    component = fixture.componentInstance;
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

  /** The Next button at the bottom of the form. */
  function nextButton(): HTMLButtonElement {
    return fixture.nativeElement.querySelector(
        '[data-test-id="config-form-next-button"]');
  }

  it('should persist the reconciled selection on the way in', async () => {
    await setUp(
        [new FakeScorer('a', 'A'), new FakeScorer('b', 'B')],
        {selectedScorers: ['ghost', 'b']});

    expect(component.config.selectedScorers).toEqual(['b']);
    expect(mockStateService.setConfig)
        .toHaveBeenCalledWith(
            jasmine.objectContaining({selectedScorers: ['b']}));
  });

  it('should reconcile the incoming configuration and persist it once',
     async () => {
       await setUp(
           [new FakeScorer('a', 'A'), new FakeScorer('b', 'B')],
           {selectedScorers: ['ghost', 'b'], autoRaterModel: ''},
           // Like the real service, so persisting re-enters the form's
           // `config$` subscriber.
           {feedConfigBack: true});

       expect(mockStateService.setConfig).toHaveBeenCalledTimes(1);
       const persisted = mockStateService.setConfig.calls.mostRecent().args[0];
       expect(persisted.selectedScorers).toEqual(['b']);
       expect(persisted.autoRaterModel).toBeTruthy();
       expect(component.config).toEqual(configSubject.value);
     });

  it('should persist a selection made through the picker', async () => {
    await setUp([new FakeScorer('a', 'A'), new FakeScorer('b', 'B')]);
    mockStateService.setConfig.calls.reset();

    checkboxes()[1].click();
    fixture.detectChanges();

    expect(component.config.selectedScorers).toEqual(['a', 'b']);
    expect(mockStateService.setConfig)
        .toHaveBeenCalledWith(
            jasmine.objectContaining({selectedScorers: ['a', 'b']}));
  });

  it('should disable Next while no scoring method is selected', async () => {
    await setUp(
        [new FakeScorer('a', 'A'), new FakeScorer('b', 'B')],
        {projectId: 'p', selectedEngine: 'e', selectedModel: 'm'});
    component.engines = [{name: 'e', displayName: 'E'}];
    fixture.detectChanges();
    expect(nextButton().disabled).toBeFalse();

    // Unchecks 'a', the default selection, leaving no scorer selected.
    checkboxes()[0].click();
    fixture.detectChanges();

    expect(nextButton().disabled).toBeTrue();
  });

  it('should disable Next while a selected scorer is misconfigured',
     async () => {
       await setUp(
           [new FakeScorer('a', 'A'), new FakeScorer('b', 'B', 'B is off')],
           {
             projectId: 'p',
             selectedEngine: 'e',
             selectedModel: 'm',
             selectedScorers: ['a', 'b']
           });
       component.engines = [{name: 'e', displayName: 'E'}];
       fixture.detectChanges();

       expect(component.canProceed()).toBeFalse();
       expect(nextButton().disabled).toBeTrue();
     });
});
