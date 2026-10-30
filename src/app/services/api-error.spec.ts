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

import {apiErrorMessage} from './api-error';

describe('apiErrorMessage', () => {
  it('should return the message of a Google API error body', () => {
    expect(apiErrorMessage(JSON.stringify({
      error: {code: 403, message: 'Permission denied', status: 'PERMISSION_DENIED'},
    }))).toBe('Permission denied');
  });

  it('should return other text trimmed', () => {
    expect(apiErrorMessage(' Service Unavailable\n')).toBe('Service Unavailable');
    expect(apiErrorMessage('{"unexpected": true}')).toBe('{"unexpected": true}');
  });

  it('should return the empty string for an empty body', () => {
    expect(apiErrorMessage('')).toBe('');
    expect(apiErrorMessage('  ')).toBe('');
  });
});
