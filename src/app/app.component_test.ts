import {TestBed} from '@angular/core/testing';
import {AppComponent} from './app.component';
import {StateService} from './services/state.service';
import {BehaviorSubject} from 'rxjs';

describe('AppComponent', () => {
  let mockStateService: jasmine.SpyObj<StateService>;
  let currentTabSubject: BehaviorSubject<string>;

  beforeEach(async () => {
    currentTabSubject = new BehaviorSubject<string>('run');
    mockStateService = jasmine.createSpyObj('StateService', [], {
      currentTab$: currentTabSubject.asObservable()
    });

    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        { provide: StateService, useValue: mockStateService }
      ]
    }).compileComponents();
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
