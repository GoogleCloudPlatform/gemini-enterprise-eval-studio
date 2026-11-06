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

import {CsvService, UTF8_BOM} from './csv.service';

describe('CsvService', () => {
  let service: CsvService;

  beforeEach(() => {
    TestBed.configureTestingModule({providers: [CsvService]});
    service = TestBed.inject(CsvService);
  });

  describe('toCsv', () => {
    it('should start with a UTF-8 byte order mark so Excel reads it as UTF-8',
       () => {
         const csv = service.toCsv([{Query: 'Boiling point?', Golden: '100°C'}]);

         expect(csv.startsWith(UTF8_BOM)).toBeTrue();
         expect(csv.slice(UTF8_BOM.length))
             .toBe('Query,Golden\r\nBoiling point?,100°C');
       });

    it('should keep multi-line and comma-separated citation cells intact',
       () => {
         const csv = service.toCsv([{
           citedSources: 'Refund Policy - https://wiki/refund\nRefund FAQ',
           citedDataStores: 'policies, issues',
           citedConnectors: '',
         }]);

         expect(csv.slice(UTF8_BOM.length))
             .toBe(
                 'citedSources,citedDataStores,citedConnectors\r\n' +
                 '"Refund Policy - https://wiki/refund\nRefund FAQ",' +
                 '"policies, issues",');
       });
  });
});
