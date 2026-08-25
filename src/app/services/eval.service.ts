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

import {EvalBackendService} from './eval-backend.service';
import {StateService} from './state.service';



interface AssistRequestBody {
  query: {text: string};
  generationSpec?: {modelId: string};
  toolsSpec?: {
    vertexAiSearchSpec?: {
      dataStoreSpecs?: Array<{dataStore: string}>;
    };
    webGroundingSpec?: {};
  };
}

/**
 * Service for evaluation operations calling real APIs.
 */
@Injectable({providedIn: 'root'})
export class EvalService {
  constructor(
      private readonly stateService: StateService,
      private readonly evalBackendService: EvalBackendService
  ) {}

  /**
   * Processes a row for evaluation by calling streamAssist API.
   * @param row The CSV row to process.
   * @param onProgress Optional callback for progress updates.
   * @returns A promise that resolves to the ResultRow.
   */
  async processRow(row: CSVRow, onProgress?: (step: 'fetch'|'score') => void):
      Promise<ResultRow> {
    const config = this.stateService.getCurrentConfig();


    const toolsSpec: NonNullable<AssistRequestBody['toolsSpec']> = {};

    if (config.selectedDataStores && config.selectedDataStores.length > 0) {
      toolsSpec.vertexAiSearchSpec = {
        dataStoreSpecs: config.selectedDataStores.map(
            ds => ({
              dataStore: `projects/${config.projectId}/locations/${
                  config.region}/collections/default_collection/dataStores/${
                  ds}`
            }))
      };
    } else if (!config.enableWebSearch) {
      toolsSpec.vertexAiSearchSpec = {};
    }

    if (config.enableWebSearch) {
      toolsSpec.webGroundingSpec = {};
    }

    const body: AssistRequestBody = {
      query: {text: row.query},
      toolsSpec,
    };

    if (config.selectedModel !== 'auto') {
      body.generationSpec = {modelId: config.selectedModel};
    }

    const projectId = config.projectId;
    const region = config.region;
    const engineId = config.selectedEngine;

    const startTime = Date.now();
    let ttft = 0;
    let ttfa = 0;
    let fullText = '';
    let assistToken = '';
    let isFirstChunk = true;
    let isFirstUserChunk = true;
    const citations: Array<{title?: string; uri?: string}> = [];
    const seenCitations = new Set<string>();

    try {
      onProgress?.('fetch');
      const response = await this.evalBackendService.callAssist({
        selectedEngine: config.selectedEngine,
        region: config.region,
        body
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

              this.extractCitations(item, citations, seenCitations);

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
                      ttfa = Date.now() - startTime;
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

      if (citations.length > 0 && !fullText.startsWith('SKIPPED:')) {
        const trimmed = fullText.trimEnd();
        fullText = trimmed + '\n\nSources:\n\n';
        for (let i = 0; i < citations.length; i++) {
          const cit = citations[i];
          const index = i + 1;
          if (cit.title && cit.uri && cit.title !== cit.uri) {
            fullText += `[${index}] ${cit.title} - ${cit.uri}\n\n`;
          } else if (cit.title) {
            fullText += `[${index}] ${cit.title}\n\n`;
          } else if (cit.uri) {
            fullText += `[${index}] ${cit.uri}\n\n`;
          }
        }
        fullText = fullText.trimEnd();
      }

      const ttlt = Date.now() - startTime;

      let score = 0;
      let scoreError: string | undefined;
      if (row.golden) {        onProgress?.('score');
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
        ttft: Number((ttft / 1000).toFixed(2)),
        ttfa: Number((ttfa / 1000).toFixed(2)),
        ttlt: Number((ttlt / 1000).toFixed(2)),
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
        ttfa: 0,
        ttlt: 0,
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
    const prompt = `${config.autoRaterInstruction}

    Query: ${query}
    Fetched Response: ${response}
    Golden Response: ${golden}

    Provide only the score as a float between 0.0 and 1.0.`;

    const body = {contents: [{role: 'user', parts: [{text: prompt}]}]};

    const res = await this.evalBackendService.callScore({
      projectId: config.projectId,
      region: config.region,
      model: config.autoRaterModel,
      body    });

    if (!res.ok) {
      let errorMessage = '';
      try {
        const errorData = await res.json();
        errorMessage = errorData.error?.message || `HTTP error! status: ${res.status}`;
      } catch (e) {
        if (res.status === 403 || res.status === 401) {
          errorMessage = 'Permission denied. Please check your Google Cloud access token.';
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
      const score = Number(cleanText);
      if (!isNaN(score)) {
        return score;
      }

      // 5. Fallback: match all decimal numbers in the text and use the last
      // one
      const matches = cleanText.match(/[0-9]+(?:\.[0-9]+)?/g);
      if (matches && matches.length > 0) {
        const lastScore = Number(matches[matches.length - 1]);
        return isNaN(lastScore) ? 0 : lastScore;
      }
    }
    return 0;
  }

  /**
   * Extracts citations from an item in the streamAssist response.
   * @param item The parsed item from streamAssist stream.
   * @param citations Array to accumulate unique citations.
   * @param seen Set of citation keys to prevent duplicates.
   */
  private extractCitations(
      item: any,
      citations: Array<{title?: string; uri?: string}>,
      seen: Set<string>,
  ): void {
    if (!item) return;
    if (Array.isArray(item)) {
      for (const elem of item) {
        this.extractCitations(elem, citations, seen);
      }
      return;
    }

    const addCitation = (title?: string, uri?: string) => {
      const cleanTitle = typeof title === 'string' ? title.trim() : '';
      const cleanUri = typeof uri === 'string' ? uri.trim() : '';
      if (!cleanTitle && !cleanUri) return;

      const key = `${cleanUri}::${cleanTitle}`;
      if (!seen.has(key)) {
        seen.add(key);
        citations.push({title: cleanTitle, uri: cleanUri});
      }
    };

    const inspectObject = (obj: any) => {
      if (!obj) return;

      // 1. groundingAttributions (web: {title, uri} or direct {title, uri})
      const attributions =
          obj.groundingAttributions || obj.groundingMetadata?.groundingAttributions;
      if (Array.isArray(attributions)) {
        for (const att of attributions) {
          if (typeof att === 'string') {
            addCitation('', att);
          } else if (att) {
            addCitation(att.web?.title || att.title, att.web?.uri || att.uri);
          }
        }
      }

      // 2. textGroundingMetadata.references (documentMetadata: {title, uri})
      const references = obj.textGroundingMetadata?.references ||
          obj.groundingMetadata?.references;
      if (Array.isArray(references)) {
        for (const ref of references) {
          if (typeof ref === 'string') {
            addCitation('', ref);
          } else if (ref) {
            addCitation(
                ref.documentMetadata?.title || ref.title,
                ref.documentMetadata?.uri || ref.uri);
          }
        }
      }

      // 3. groundingChunks (web or retrievedContext: {title, uri})
      const chunks =
          obj.groundingMetadata?.groundingChunks || obj.groundingChunks;
      if (Array.isArray(chunks)) {
        for (const chunk of chunks) {
          if (typeof chunk === 'string') {
            addCitation('', chunk);
          } else if (chunk) {
            addCitation(
                chunk.web?.title || chunk.retrievedContext?.title || chunk.title,
                chunk.web?.uri || chunk.retrievedContext?.uri || chunk.uri);
          }
        }
      }

      // 4. citationMetadata.citations ({title, uri})
      const cits = obj.citationMetadata?.citations || obj.citations;
      if (Array.isArray(cits)) {
        for (const cit of cits) {
          if (typeof cit === 'string') {
            addCitation('', cit);
          } else if (cit) {
            addCitation(cit.title, cit.uri || cit.url);
          }
        }
      }
    };

    const objectsToInspect = [
      item,
      item.answer,
      ...(Array.isArray(item.answer?.replies) ? item.answer.replies : []),
      ...(Array.isArray(item.replies) ? item.replies : []),
      ...(Array.isArray(item.candidates) ? item.candidates : []),
    ];

    for (const obj of objectsToInspect) {
      if (!obj) continue;
      inspectObject(obj);
      if (obj.groundedContent) {
        inspectObject(obj.groundedContent);
      }
    }
  }
}
