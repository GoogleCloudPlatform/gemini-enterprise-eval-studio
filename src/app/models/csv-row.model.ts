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

/**
 * Represents a row in the input CSV file.
 */
export interface CSVRow {
  query: string;
  golden: string;
  // Optional. Used to group rows into a conversation.
  conversationId?: string;
  /**
   * Optional. Determines execution order within a conversationId
   * (ascending numeric order). If omitted, rows are processed in their
   * original CSV order.
   */
  turn?: string;
  [key: string]: string | undefined;
}
