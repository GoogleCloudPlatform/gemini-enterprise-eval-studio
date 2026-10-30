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
 * Reduces the body of a failed Google API response to the message worth
 * showing the user. Such bodies are usually JSON of the form
 * `{"error": {"message": ...}}`; anything else is returned as is, trimmed.
 *
 * @param body The response body.
 * @return The error's message, or the trimmed body, which may be empty.
 */
export function apiErrorMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as {error?: {message?: unknown}};
    const message = parsed?.error?.message;
    if (typeof message === 'string' && message) {
      return message;
    }
  } catch {
    // Not JSON: fall through to the raw text.
  }
  return body.trim();
}
