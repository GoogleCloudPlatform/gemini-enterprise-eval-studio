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

import {agentIdFromResourceName} from '../models/agent.model';
import {AppConfig} from '../models/app-config.model';
import {CSVRow} from '../models/csv-row.model';
import {ResultErrorCode, ResultRow, isScorableRow} from '../models/result-row.model';
import {RowScoreError, ScorerRunResult, ScoringRequest} from '../scoring/scorer';
import {ScorerRegistry} from '../scoring/scorer.registry';
import {resolveRowGrounding} from '../utils/row-config.util';

import {EvalBackendService} from './eval-backend.service';
import {StateService} from './state.service';

interface SessionInfo {
  session?: string;
  turnId?: string;
  [key: string]: unknown;
}

interface StreamState {
  startTime: number;
  ttft: number;
  ttfa: number;
  fullText: string;
  thoughts: string[];
  isFirstChunk: boolean;
  isFirstUserChunk: boolean;
}

interface AssistRequestBody {
  query: {text: string};
  session?: string;
  generationSpec?: {modelId: string};
  toolsSpec?: {
    vertexAiSearchSpec?: {
      dataStoreSpecs?: Array<{dataStore: string}>;
    };
    webGroundingSpec?: {};
  };
  /** Routes the query to a published agent instead of the default assistant. */
  agentsSpec?: {agentSpecs: Array<{agentId: string}>};
}

/**
 * Checks that a score honors the `ScoreResult` contract.
 * @param score The score a scorer returned.
 * @throws A `RowScoreError` with a user facing message when the score is not
 *     a finite number between 0.0 and 1.0 inclusive.
 */
function assertNormalizedScore(score: number): void {
  // A scorer that builds its result from a parsed reply can hand over a
  // string despite the type. Naming the type keeps the message from reading
  // as "0.5 is not a number".
  if (typeof score !== 'number') {
    const type = typeof score;
    throw new RowScoreError(
        `Score ${score} (${type}) is not a number between 0.0 and 1.0.`);
  }
  // Every comparison with NaN is false, so the range check alone would let it
  // through; `Number.isFinite` also rejects the infinities.
  if (!Number.isFinite(score)) {
    throw new RowScoreError(
        `Score ${score} is not a number between 0.0 and 1.0.`);
  }
  if (score < 0 || score > 1) {
    throw new RowScoreError(
        `Score ${score} is outside the 0.0 to 1.0 range.`);
  }
}

/**
 * Service for evaluation operations calling real APIs.
 */
@Injectable({providedIn: 'root'})
export class EvalService {
  traceRetryMaxAttempts = 10;
  traceRetryDelayMs = 2000;

  constructor(
      private readonly stateService: StateService,
      private readonly evalBackendService: EvalBackendService,
      private readonly scorerRegistry: ScorerRegistry,
  ) {}

  /**
   * Processes a row for evaluation by calling streamAssist API.
   * @param row The CSV row to process.
   * @param onProgress Optional callback for progress updates.
   * @param session Optional session resource name to continue a multi-turn conversation.
   * @param config The settings to run the row against. A caller running a
   *     batch passes the settings captured when the run started, so every
   *     row in the run uses the same settings. Defaults to the current
   *     settings.
   * @returns A promise that resolves to the ResultRow.
   */
  async processRow(
      row: CSVRow,
      onProgress?: (step: 'fetch'|'score') => void,
      session?: string,
      config: AppConfig = this.stateService.getCurrentConfig(),
  ): Promise<ResultRow> {
    const grounding = resolveRowGrounding(
        row, config, this.stateService.getConnectors(config.selectedEngine));

    // Once toolsSpec is sent, Vertex AI Search runs only if toolsSpec has a
    // vertexAiSearchSpec. A vertexAiSearchSpec without dataStoreSpecs searches
    // the engine's own data stores, which is the behavior of a run without
    // connectors. A row whose override leaves no data stores therefore omits
    // vertexAiSearchSpec, so it is not grounded on the engine's data stores.
    const toolsSpec: NonNullable<AssistRequestBody['toolsSpec']> = {};

    if (grounding.dataStoreIds.length > 0) {
      toolsSpec.vertexAiSearchSpec = {
        dataStoreSpecs: grounding.dataStoreIds.map(
            ds => ({
              dataStore: `projects/${config.projectId}/locations/${
                  config.region}/collections/default_collection/dataStores/${
                  ds}`
            }))
      };
    } else if (grounding.searchAllDataStores) {
      toolsSpec.vertexAiSearchSpec = {};
    }

    if (grounding.enableWebSearch) {
      toolsSpec.webGroundingSpec = {};
    }

    const body: AssistRequestBody = {
      query: {text: row.query},
      toolsSpec,
    };

    if (session) {
      body.session = session;
    }

    if (config.selectedModel !== 'auto') {
      body.generationSpec = {modelId: config.selectedModel};
    }

    // streamAssist takes the bare agent ID, while the config holds the full
    // resource name. With no agent selected, agentsSpec is omitted so the query
    // goes to the default assistant.
    const agentId = agentIdFromResourceName(config.selectedAgent);
    if (agentId) {
      body.agentsSpec = {agentSpecs: [{agentId}]};
    }

    const projectId = config.projectId.trim();
    if (!projectId) {
      throw new Error('Project ID is required.');
    }
    const region = config.region;
    const engineId = config.selectedEngine;

    const streamState: StreamState = {
      startTime: Date.now(),
      ttft: 0,
      ttfa: 0,
      fullText: '',
      thoughts: [],
      isFirstChunk: true,
      isFirstUserChunk: true,
    };
    let assistToken = '';
    let errorCode: ResultErrorCode = '';
    let traceId: string|undefined;
    let sessionInfo: SessionInfo|undefined;
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
        const errorBody = await response.text().catch(() => '');
        let errorData: any;
        try {
          const parsed = JSON.parse(errorBody);
          errorData = Array.isArray(parsed) ? parsed[0] : parsed;
        } catch {
          // Body is not JSON; fall back to statusText or default reason.
        }

        if (response.status === 429) {
          errorCode = 'RATE_LIMITED';
          assistToken =
              errorData?.details?.[0]?.assistToken ||
              errorData?.error?.details?.[0]?.assistToken ||
              'unknown';
          const reason =
              errorData?.details?.[0]?.reason ||
              errorData?.error?.message ||
              'Rate limit exceeded';
          throw new Error(`Rate limited: ${reason}`);
        }
        errorCode = `HTTP_${response.status}`;
        const statusText =
            response.statusText ? ` ${response.statusText}` : '';
        const detail = errorData?.error?.message ?? '';
        throw new Error(
            `HTTP error! status: ${response.status}${detail ? ` - ${detail}` : statusText}`);
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

              if (item.sessionInfo) {
                sessionInfo = {
                  ...sessionInfo,
                  ...item.sessionInfo,
                  session: item.sessionInfo.session ?? sessionInfo?.session,
                  turnId: item.sessionInfo.turnId ?? sessionInfo?.turnId,
                };
              }

              if (item.answer?.state === 'SKIPPED') {
                const reason =
                    item.answer?.assistSkippedReasons?.[0] || 'Unknown reason';
                streamState.fullText = `SKIPPED: ${reason}`;
                errorCode = 'SKIPPED';
                break;
              }
              if (item.answer?.state === 'FAILED') {
                errorCode = 'FAILED';
              }
              const replies = item.answer?.replies || [];
              for (const reply of replies) {
                this.processReply(reply, streamState);
              }
            }
          }
        } catch (e) {
          console.error('Error processing chunk:', e);
        }
      }

      if (errorCode === 'FAILED') {
        streamState.fullText =
            `FAILED: ${streamState.fullText.trim() || 'Assist operation failed.'}`;
      }

      if (citations.length > 0 && !streamState.fullText.startsWith('SKIPPED:')) {
        const trimmed = streamState.fullText.trimEnd();
        streamState.fullText = trimmed + '\n\nSources:\n\n';
        for (let i = 0; i < citations.length; i++) {
          const cit = citations[i];
          const index = i + 1;
          if (cit.title && cit.uri && cit.title !== cit.uri) {
            streamState.fullText += `[${index}] ${cit.title} - ${cit.uri}\n\n`;
          } else if (cit.title) {
            streamState.fullText += `[${index}] ${cit.title}\n\n`;
          } else if (cit.uri) {
            streamState.fullText += `[${index}] ${cit.uri}\n\n`;
          }
        }
        streamState.fullText = streamState.fullText.trimEnd();
      }

      const ttlt = Date.now() - streamState.startTime;
      const traceIdPromise =
          !traceId && assistToken && assistToken !== 'unknown' ?
          this.resolveTraceId(projectId, assistToken) :
          Promise.resolve(traceId);

      let scorerResults: ScorerRunResult[] = [];
      if (isScorableRow(errorCode)) {
        onProgress?.('score');
        scorerResults = await this.scoreAll({
          query: row.query,
          response: streamState.fullText,
          golden: row.golden,
          config
        });
      } else {
        console.warn('Skipping scoring for row:', {
          errorCode,
          conversationId: row.conversationId,
          turn: row.turn,
        });
      }

      traceId = await traceIdPromise;

      return {
        query: row.query,
        golden: row.golden || '',
        fetched: streamState.fullText,
        thoughts: streamState.thoughts.join('\n'),
        errorCode,
        ttft: Number((streamState.ttft / 1000).toFixed(2)),
        ttfa: Number((streamState.ttfa / 1000).toFixed(2)),
        ttlt: Number((ttlt / 1000).toFixed(2)),
        scorerResults,
        assistToken,
        projectId,
        region,
        engineId,
        agentId,
        session: sessionInfo?.session ?? session,
        turnId: sessionInfo?.turnId,
        traceId,
        traceUrl: this.getTraceUrl(traceId, projectId),
        connectorsUsed: grounding.connectorsUsed,
      };

    } catch (error) {
      console.error('Error processing row:', error);
      if (!traceId && assistToken && assistToken !== 'unknown') {
        traceId = await this.resolveTraceId(projectId, assistToken, 1);
      }
      const errorMessage =
          error instanceof Error ? error.message : String(error);
      return {
        query: row.query,
        golden: row.golden || '',
        fetched: `Error: ${errorMessage}`,
        thoughts: streamState.thoughts.join('\n'),
        errorCode: errorCode || 'ERROR',
        ttft: 0,
        ttfa: 0,
        ttlt: 0,
        scorerResults: [],
        assistToken,
        projectId,
        region,
        engineId,
        agentId,
        session: sessionInfo?.session ?? session,
        turnId: sessionInfo?.turnId,
        traceId,
        traceUrl: this.getTraceUrl(traceId, projectId),
        connectorsUsed: grounding.connectorsUsed,
      };
    }
  }

  /**
   * Processes a single reply from a streamAssist chunk, updating timing
   * metrics, answer text, and thinking traces.
   */
  private processReply(reply: any, state: StreamState): void {
    const content = reply?.groundedContent?.content;
    if (!content) return;

    const text = typeof content.text === 'string' ? content.text : '';
    const thought = Boolean(content.thought);
    if (!text && !thought) return;

    if (state.isFirstChunk) {
      state.ttft = Date.now() - state.startTime;
      state.isFirstChunk = false;
    }

    if (!thought && text && state.isFirstUserChunk) {
      state.ttfa = Date.now() - state.startTime;
      state.isFirstUserChunk = false;
    }

    if (text && !thought) {
      state.fullText += text;
    }

    if (text && thought) {
      // Each streamed thought is its own reply, so internal newlines are
      // folded away rather than being mistaken for extra thoughts.
      const line = text.replace(/\s+/g, ' ').trim();
      if (line) {
        state.thoughts.push(line);
      }
    }
  }

  private async resolveTraceId(
      projectId: string,
      assistToken: string,
      maxAttempts = this.traceRetryMaxAttempts,
  ): Promise<string|undefined> {
    if (!projectId.trim() || !assistToken || assistToken === 'unknown') {
      return undefined;
    }
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const traceId =
            await this.evalBackendService.fetchTraceId(projectId, assistToken);
        if (traceId) {
          return traceId;
        }
      } catch (error) {
        console.warn('Error fetching trace ID:', error);
        return undefined;
      }
      if (attempt < maxAttempts - 1 && this.traceRetryDelayMs > 0) {
        await new Promise(
            resolve => setTimeout(resolve, this.traceRetryDelayMs));
      }
    }
    return undefined;
  }

  private getTraceUrl(
      traceId: string|undefined,
      projectId: string,
  ): string|undefined {
    const trimmedProjectId = projectId.trim();
    if (traceId && trimmedProjectId) {
      return `https://console.cloud.google.com/traces/explorer;traceId=${
          encodeURIComponent(traceId)};duration=P30D?project=${
          encodeURIComponent(trimmedProjectId)}`;
    }
    return undefined;
  }

  /**
   * Runs every scorer named by the configuration against a single response.
   *
   * The scorers run one after another rather than concurrently, so a run
   * spreads its load over time instead of firing every scorer's backend call
   * at once. A scorer that throws does not stop the others: its failure is
   * recorded on its own entry.
   *
   * @param request The query, response, golden answer and active config.
   * @returns One entry per configured scorer, in run order. Never empty.
   */
  async scoreAll(request: ScoringRequest): Promise<ScorerRunResult[]> {
    const scorers =
        this.scorerRegistry.resolveAll(request.config.selectedScorers);
    const results: ScorerRunResult[] = [];

    for (const scorer of scorers) {
      const entry: ScorerRunResult = {
        scorerId: scorer.id,
        displayName: scorer.displayName,
        score: 0
      };

      if (scorer.requiresGolden && !request.golden) {
        entry.skipped = true;
        results.push(entry);
        continue;
      }

      try {
        const result = await scorer.score(request);
        // The results table, the CSV export and Compare Evals all assume a
        // score between 0.0 and 1.0, so anything else is a scorer failure to
        // report on the row rather than a value to store. The auto-rater can
        // produce one when the judge answers in prose ("8/10" parses as 80).
        assertNormalizedScore(result.score);
        entry.score = result.score;
        if (result.details) {
          console.debug(
              `Scorer '${scorer.id}' details:`,
              {query: request.query, ...result.details});
        }
      } catch (error) {
        console.error(
            `Error scoring response with '${scorer.id}' during evaluation:`,
            error);
        // A rejection is not necessarily an `Error`, so a thrown string or
        // object still gets a readable message instead of `undefined`.
        entry.error = error instanceof Error ? error.message : String(error);
        if (error instanceof RowScoreError) {
          entry.rowError = true;
        }
      }
      results.push(entry);
    }

    return results;
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
