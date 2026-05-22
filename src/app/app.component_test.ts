import {TestBed} from '@angular/core/testing';
import {BehaviorSubject} from 'rxjs';

import {AppComponent} from './app.component';
import {AppConfig} from './models/app-config.model';
import {ResultRow} from './models/result-row.model';
import {StateService} from './services/state.service';

describe('AppComponent', () => {
  let mockStateService: jasmine.SpyObj<StateService>;
  let currentTabSubject: BehaviorSubject<string>;
  let resultsSubject: BehaviorSubject<ResultRow[]>;
  let configSubject: BehaviorSubject<AppConfig>;

  beforeEach(async () => {
    currentTabSubject = new BehaviorSubject<string>('run');
    resultsSubject = new BehaviorSubject<ResultRow[]>([]);
    configSubject = new BehaviorSubject<AppConfig>({
      gCloudToken: '',
      projectId: '',
      region: 'global',
      selectedEngine: '',
      selectedModel: '',
      geminiApiKey: '',
      autoRaterInstruction: '',
      selectedDataStores: [],
      enableWebSearch: false
    });
    mockStateService = jasmine.createSpyObj('StateService', [], {
      currentTab$: currentTabSubject.asObservable(),
      results$: resultsSubject.asObservable(),
      config$: configSubject.asObservable()
    });

    await TestBed
        .configureTestingModule({
          imports: [AppComponent],
          providers: [{provide: StateService, useValue: mockStateService}]
        })
        .compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it(`should have as currentTab 'run'`, () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    fixture.detectChanges();
    expect(app.currentTab).toEqual('run');
  });
});
