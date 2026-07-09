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

import 'zone.js';
import 'zone.js/testing';

import {expect, vi} from 'vitest';

// --- Part 1: Zone.js Vitest Patch ---

const DESCRIBE_FACTORY_NAMES = [
  'skip',
  'skipIf',
  'runIf',
  'only',
  'concurrent',
  'sequential',
  'shuffle',
  'todo',
  'each',
  'for',
] as const;

const TEST_FACTORY_NAMES = [
  'skip',
  'skipIf',
  'runIf',
  'only',
  'concurrent',
  'sequential',
  'shuffle',
  'todo',
  'each',
  'for',
] as const;

function patchVitest(Zone: any): void {
  Zone.__load_patch('vitest', (context: any, Zone: any) => {
    const vitestGlobal = context['vitest'];

    // Skip patching if vitest is not present or has already been patched
    if (typeof vitestGlobal === 'undefined' || vitestGlobal['__zone_patch__']) {
      return;
    }
    vitestGlobal['__zone_patch__'] = true;

    // Ensure other testing related Zone.js patches have been applied
    if (!Zone.ProxyZoneSpec) {
      throw new Error('Missing ProxyZoneSpec');
    }
    if (!Zone.SyncTestZoneSpec) {
      throw new Error('Missing SyncTestZoneSpec');
    }

    // Setup testing related Zone instances
    const rootZone = Zone.current;
    const syncZone =
        rootZone.fork(new Zone.SyncTestZoneSpec('vitest.describe'));
    const proxyZone = rootZone.fork(new Zone.ProxyZoneSpec());

    /**
     * Gets a function wrapping the body of a vitest `describe` block to execute
     * in a synchronous-only zone.
     */
    function wrapDescribeInZone(describeBody: Function): Function {
      return function(this: unknown, ...args: unknown[]) {
        return syncZone.run(describeBody, this, args);
      };
    }

    /**
     * Gets a function wrapping the body of a vitest `it/beforeEach/afterEach`
     * block to execute in a ProxyZone zone.
     */
    function wrapTestInZone(testBody: Function): Function {
      if (typeof testBody !== 'function') {
        return testBody;
      }
      const wrappedFunc = function() {
        return proxyZone.run(testBody, null, arguments as any);
      };
      // Update the length of wrappedFunc to be the same as the length of the
      // testBody So vitest core can handle whether the test function has
      // `done()` or not correctly
      Object.defineProperty(wrappedFunc, 'length', {
        configurable: true,
        writable: true,
        enumerable: false,
      });
      wrappedFunc.length = testBody.length;
      return wrappedFunc;
    }

    ['suite', 'describe'].forEach((methodName) => {
      let originalVitestFn = context[methodName];
      // Skip if already patched
      if (context[Zone.__symbol__(methodName)]) {
        return;
      }

      context[Zone.__symbol__(methodName)] = originalVitestFn;
      context[methodName] = function(
          this: unknown, ...args: [unknown, Function, ...unknown[]]) {
        args[1] = wrapDescribeInZone(args[1]);
        return originalVitestFn.apply(this, args);
      };

      for (const factoryName of DESCRIBE_FACTORY_NAMES) {
        context[methodName][factoryName] = function(
            this: unknown, ...factoryArgs: unknown[]) {
          const originalDescribeFn = originalVitestFn.apply(this, factoryArgs);
          return function(
              this: unknown, ...args: [unknown, Function, ...unknown[]]) {
            args[1] = wrapDescribeInZone(args[1]);
            return originalDescribeFn.apply(this, args);
          };
        };
      }
    });

    ['it', 'test'].forEach((methodName) => {
      let originalVitestFn = context[methodName];
      // Skip if already patched
      if (context[Zone.__symbol__(methodName)]) {
        return;
      }

      context[Zone.__symbol__(methodName)] = originalVitestFn;
      context[methodName] = function(
          this: unknown, ...args: [unknown, Function, ...unknown[]]) {
        args[1] = wrapTestInZone(args[1]);
        return originalVitestFn.apply(this, args);
      };

      for (const factoryName of TEST_FACTORY_NAMES) {
        context[methodName][factoryName] = function(
            this: unknown, ...factoryArgs: unknown[]) {
          return function(
              this: unknown, ...args: [unknown, Function, ...unknown[]]) {
            args[1] = wrapTestInZone(args[1]);
            return originalVitestFn.apply(this, factoryArgs).apply(this, args);
          };
        };
      }
    });

    ['beforeEach', 'afterEach', 'beforeAll', 'afterAll'].forEach(
        (methodName) => {
          const originalVitestFn = context[methodName];
          if (context[Zone.__symbol__(methodName)]) {
            return;
          }

          context[Zone.__symbol__(methodName)] = originalVitestFn;
          context[methodName] = function(
              this: unknown, ...args: [Function, ...unknown[]]) {
            args[0] = wrapTestInZone(args[0]);
            return originalVitestFn.apply(this, args);
          };
        });
  });
}

// Apply the patch immediately if Zone is available
if (typeof globalThis !== 'undefined' && (globalThis as any).Zone) {
  patchVitest((globalThis as any).Zone);
}

// --- Part 2: Jasmine-to-Vitest Compatibility Shim ---

function wrapSpy(mock: any) {
  const spy = mock as any;
  spy.and = {
    returnValue: (val: any) => {
      mock.mockReturnValue(val);
      return spy;
    },
    callFake: (fn: any) => {
      mock.mockImplementation(fn);
      return spy;
    },
    callThrough: () => {
      mock.mockRestore?.();
      return spy;
    }
  };

  Object.defineProperty(spy, 'calls', {
    get: () => ({
      mostRecent: () =>
          ({args: mock.mock.calls[mock.mock.calls.length - 1] || []}),
      any: () => mock.mock.calls.length > 0,
      count: () => mock.mock.calls.length,
      reset: () => mock.mockClear(),
    }),
    configurable: true
  });

  return spy;
}

if (typeof globalThis !== 'undefined') {
  (globalThis as any).spyOn = (obj: any, methodName: string) => {
    return wrapSpy(vi.spyOn(obj, methodName as any));
  };

  (globalThis as any).jasmine = {
    any: (type: any) => {
      return expect.any(type);
    },
    createSpy: (name?: string) => {
      return wrapSpy(vi.fn());
    },
    createSpyObj: (
        displayName: string, methodNames?: any, propertyNames?: any) => {
      const obj: any = {};

      // Handle methodNames (can be array of strings or object of method/value
      // pairs)
      if (Array.isArray(methodNames)) {
        for (const name of methodNames) {
          obj[name] = wrapSpy(vi.fn());
        }
      } else if (typeof methodNames === 'object' && methodNames !== null) {
        for (const [name, value] of Object.entries(methodNames)) {
          obj[name] = wrapSpy(vi.fn().mockReturnValue(value));
        }
      }

      // Handle propertyNames (can be array of strings or object of
      // property/value pairs)
      if (Array.isArray(propertyNames)) {
        for (const name of propertyNames) {
          const spy = vi.fn();
          Object.defineProperty(
              obj, name,
              {get: spy, set: (val) => spy(val), configurable: true});
        }
      } else if (typeof propertyNames === 'object' && propertyNames !== null) {
        for (const [name, value] of Object.entries(propertyNames)) {
          Object.defineProperty(
              obj, name, {value: value, writable: true, configurable: true});
        }
      }

      return obj;
    },
    objectContaining: (val: any) => {
      return expect.objectContaining(val);
    }
  };

  (globalThis as any).expectAsync = (actual: Promise<any>) => {
    return {
      toBeResolved: async () => {
        await expect(actual).resolves.toBeDefined();
      },
      toBeRejected: async () => {
        await expect(actual).rejects.toThrow();
      },
      toBeRejectedWithError: async (type: any, message?: string|RegExp) => {
        await expect(actual).rejects.toThrow(message || type);
      }
    };
  };

  // Extend Vitest's expect with Jasmine-style matchers
  expect.extend({
    toBeFalse(received) {
      return {
        pass: received === false,
        message: () => `expected ${received} to be false`,
      };
    },
    toBeTrue(received) {
      return {
        pass: received === true,
        message: () => `expected ${received} to be true`,
      };
    },
  });
}
