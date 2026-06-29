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

import {Injectable} from '@angular/core';

import {AppConfig} from '../models/app-config.model';
import {CSVRow} from '../models/csv-row.model';
import {ResultRow} from '../models/result-row.model';

import {StateService} from './state.service';

/**
 * Service for evaluation operations calling real APIs.
 */
@Injectable({providedIn: 'root'})
export class EvalService {
  constructor(private stateService: StateService) {}

  /**
   * Processes a row for evaluation by calling streamAssist API.
   * @param row The CSV row to process.
   * @param onProgress Optional callback for progress updates.
   * @returns A promise that resolves to the ResultRow.
   */
  async processRow(row: CSVRow, onProgress?: (step: 'fetch'|'score') => void):
      Promise<ResultRow> {
    const config = this.stateService.getCurrentConfig();
    const baseUrl = config.region === 'global' ?
        'discoveryengine.googleapis.com' :
        `${config.region}-discoveryengine.googleapis.com`;

    const url = `https://${baseUrl}/v1/${
        config.selectedEngine}/assistants/default_assistant:streamAssist`;

    const body: any = {query: {text: row.query}};

    if (config.selectedModel !== 'auto') {
      body.generationSpec = {modelId: config.selectedModel};
    }

    body.toolsSpec = {};

    if (config.selectedDataStores && config.selectedDataStores.length > 0) {
      body.toolsSpec.vertexAiSearchSpec = {
        dataStoreSpecs: config.selectedDataStores.map(
            ds => ({
              dataStore: `projects/${config.projectId}/locations/${
                  config.region}/collections/default_collection/dataStores/${
                  ds}`
            }))
      };
    } else if (!config.enableWebSearch) {
      body.toolsSpec.vertexAiSearchSpec = {};
    }

    if (config.enableWebSearch) {
      body.toolsSpec.webGroundingSpec = {};
    }

    const projectId = config.projectId;
    const region = config.region;
    const engineId = config.selectedEngine;

    const startTime = Date.now();
    let ttft = 0;
    let tfuft = 0;
    let fullText = '';
    let assistToken = '';
    let isFirstChunk = true;
    let isFirstUserChunk = true;

    try {
      onProgress?.('fetch');
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.gCloudToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        if (response.status === 429) {
          const errorData = await response.json();
          assistToken = errorData.details?.[0]?.assistToken || 'unknown';
          const reason =
              errorData.details?.[0]?.reason || 'Rate limit exceeded';
          throw new Error(`Rate limited: ${reason}`);
        }
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let accumulatedText = '';
      let processedItemsCount = 0;

      while (true) {
        const {done, value} = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, {stream: true});
        accumulatedText += chunk;

        try {
          let parsedData;
          try {
            parsedData = JSON.parse(accumulatedText);
          } catch (e) {
            if (accumulatedText.startsWith('[')) {
              try {
                const cleanedText = accumulatedText.trim().replace(/,\s*$/, '');
                parsedData = JSON.parse(cleanedText + ']');
              } catch (e2) {
                continue;
              }
            } else {
              continue;
            }
          }

          if (parsedData && Array.isArray(parsedData)) {
            for (let i = processedItemsCount; i < parsedData.length; i++) {
              const item = parsedData[i];
              processedItemsCount++;

              if (item.assistToken) {
                assistToken = item.assistToken;
              }

              if (item.answer?.state === 'SKIPPED') {
                const reason =
                    item.answer?.assistSkippedReasons?.[0] || 'Unknown reason';
                fullText = `SKIPPED: ${reason}`;
                break;
              }
              const replies = item.answer?.replies || [];
              for (const reply of replies) {
                const content = reply.groundedContent?.content;
                if (content) {
                  const text = content.text;
                  const thought = content.thought;

                  if (text || thought) {
                    if (isFirstChunk) {
                      ttft = Date.now() - startTime;
                      isFirstChunk = false;
                    }

                    if (!thought && text && isFirstUserChunk) {
                      tfuft = Date.now() - startTime;
                      isFirstUserChunk = false;
                    }

                    if (text && !thought) {
                      fullText += text;
                    }
                  }
                }
              }
            }
          }
        } catch (e) {
          console.error('Error processing chunk:', e);
        }
      }

      const latency = Date.now() - startTime;

      let score = 0;
      let scoreError: string | undefined;
      if (config.gCloudToken && row.golden) {
        onProgress?.('score');
        try {
          score =
              await this.scoreResponse(row.query, fullText, row.golden, config);
        } catch (error) {
          console.error('Error scoring response during evaluation:', error);
          scoreError = (error as Error).message;
        }
      }

      return {
        query: row.query,
        golden: row.golden || '',
        fetched: fullText,
        ttft,
        tfuft,
        latency,
        score,
        assistToken,
        projectId,
        region,
        engineId,
        scoreError
      };

    } catch (error) {
      console.error('Error processing row:', error);
      return {
        query: row.query,
        golden: row.golden || '',
        fetched: 'Error: ' + error,
        ttft: 0,
        tfuft: 0,
        latency: 0,
        score: 0,
        assistToken,
        projectId,
        region,
        engineId
      };
    }
  }

  /**
   * Scores the response using Gemini API.
   * @param query The original query.
   * @param response The fetched response to score.
   * @param golden The golden response to compare against.
   * @param config The application configuration.
   * @returns A promise that resolves to the score as a number.
   */
  async scoreResponse(
      query: string, response: string, golden: string,
      config: AppConfig): Promise<number> {
    const url = `https://aiplatform.googleapis.com/v1/projects/${
        config.projectId}/locations/global/publishers/google/models/${
        config.autoRaterModel}:generateContent`;

    const prompt = `${config.autoRaterInstruction}

    Query: ${query}
    Fetched Response: ${response}
    Golden Response: ${golden}

    Provide only the score as a float between 0.0 and 1.0.`;

    const body = {contents: [{role: 'user', parts: [{text: prompt}]}]};

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.gCloudToken}`,
        'x-goog-user-project': config.projectId,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      let errorMessage = '';
      try {
        const errorData = await res.json();
        errorMessage = errorData.error?.message || `HTTP error! status: ${res.status}`;
      } catch (e) {
        if (res.status === 403 || res.status === 401) {
          errorMessage = 'Permission denied. Please check your Gemini API key.';
        } else if (res.status === 404) {
          errorMessage = `Model '${config.autoRaterModel}' not found or not available.`;
        } else if (res.status === 429) {
          errorMessage = 'Rate limit exceeded. Please try again later.';
        } else if (res.status === 503) {
          errorMessage = 'Service temporarily unavailable. Please try again later.';
        } else {
          errorMessage = `HTTP error! status: ${res.status}`;
        }
      }
      throw new Error(errorMessage);
    }

    const data = await res.json();
    let text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text) {
      // 1. Remove markdown code block markers
      text = text.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '');

      // 2. Remove typical prefix strings like "Score: "
      text = text.replace(
          /^(?:Score|score|Rating|rating|Similarity Score|similarity score|Similarity score)\s*:\s*/g,
          '');

      // 3. Strip range and scale descriptors to avoid matching scale. Removed
      // strings like these because the scale is mentioned in the instruction.
      // Sample strings - endpoints (0.0, 1.0) between 0.0 and 1.0 / between
      // 0 and 1 0.0 to 1.0 / 0 to 1 / 0-1 [0.0, 1.0] / [0, 1] out of 1 / out
      // of 1.0 / 1 / / 1.0
      let cleanText = text.replace(
          /between\s+0?(?:\.0)?\s+(?:and|to)\s+1?(?:\.0)?/gi, '');
      cleanText =
          cleanText.replace(/0?(?:\.0)?\s*(?:-|to)\s*1?(?:\.0)?/g, '');
      cleanText =
          cleanText.replace(/\[\s*0?(?:\.0)?\s*,\s*1?(?:\.0)?\s*\]/g, '');
      cleanText = cleanText.replace(/out\s+of\s+1?(?:\.0)?/gi, '');
      cleanText = cleanText.replace(/\/\s*1?(?:\.0)?/g, '');

      cleanText = cleanText.trim();

      // 4. Try direct parseFloat first
      let score = parseFloat(cleanText);
      if (!isNaN(score)) {
        return score;
      }

      // 5. Fallback: match all decimal numbers in the text and use the last
      // one
      const matches = cleanText.match(/[0-9]+(?:\.[0-9]+)?/g);
      if (matches && matches.length > 0) {
        const lastScore = parseFloat(matches[matches.length - 1]);
        return isNaN(lastScore) ? 0 : lastScore;
      }
    }
    return 0;
  }
}
