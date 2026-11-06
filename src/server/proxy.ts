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

import {Request, Response, Router} from 'express';
import {google} from 'googleapis';

import {createAuthenticateMiddleware} from './auth';
import {Config} from './config';
import {RefreshTokenStore} from './store';

const ENGINE_PATH_REGEX = /^projects\/([^/]+)\/locations\/([^/]+)\/collections\/([^/]+)\/engines\/([^/]+)$/;
const REGION_REGEX = /^[a-z0-9-]+$/;

/** A project ID, or a numeric project number. */
const PROJECT_ID_REGEX = /^(?:[a-z][a-z0-9-]{4,28}[a-z0-9]|[0-9]+)$/;

/** A single resource ID segment, such as an engine or collection ID. */
const RESOURCE_ID_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

/**
 * A full engine resource name whose segments contain no characters that could
 * change the meaning of a URL (no `.`, `?`, `#`, `%` or extra `/`).
 */
const STRICT_ENGINE_PATH_REGEX =
    /^projects\/[a-z0-9-]+\/locations\/([a-z0-9-]+)\/collections\/[a-zA-Z0-9][a-zA-Z0-9_-]*\/engines\/[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

/** The largest page size that ListAgents accepts. */
const MAX_AGENT_PAGE_SIZE = 1000;

// Keep Discovery Engine and Vertex AI endpoint routing in sync with
// src/app/services/direct-gcp-eval-backend.service.ts.

/** Multi-regional locations that use Vertex AI `.rep.googleapis.com` endpoints. */
const VERTEX_MULTI_REGIONAL_LOCATIONS: ReadonlySet<string> =
    new Set(['us', 'eu']);

/**
 * Returns the Discovery Engine API hostname for the given location.
 */
function discoveryEngineBaseUrl(region: string): string {
  return region === 'global'
    ? 'discoveryengine.googleapis.com'
    : `${region}-discoveryengine.googleapis.com`;
}

/**
 * Returns the Vertex AI API hostname for the given location.
 *
 * Multi-regional locations (`us`, `eu`) use Multi-Regional Endpoints
 * (`aiplatform.{region}.rep.googleapis.com`), `global` uses
 * `aiplatform.googleapis.com`, and single regions use
 * `{region}-aiplatform.googleapis.com`.
 */
function vertexAiBaseUrl(region: string): string {
  if (region === 'global') {
    return 'aiplatform.googleapis.com';
  }
  if (VERTEX_MULTI_REGIONAL_LOCATIONS.has(region)) {
    return `aiplatform.${region}.rep.googleapis.com`;
  }
  return `${region}-aiplatform.googleapis.com`;
}

/**
 * Expands an `engineId` query parameter into a full engine resource name.
 *
 * The client sends either a full `projects/.../engines/{id}` resource name or
 * a bare engine ID. Both are validated, not just normalized, because the result
 * is interpolated into an upstream request URL and an unvetted value could
 * address a resource other than the one named.
 *
 * A full resource name must be in `region`, since the request is sent to that
 * region's endpoint. Its project is not compared with `projectId`: engine
 * names carry the project number, while `projectId` is usually the project ID.
 *
 * @param projectId The validated project ID, used to expand a bare engine ID.
 * @param region The validated region. A bare engine ID is expanded into it,
 *     and a full resource name must name it.
 * @param engineId A full engine resource name or a bare engine ID.
 * @return The engine resource name, or null if `engineId` is not a valid
 *     engine reference in `region`.
 */
export function resolveEnginePath(
    projectId: string, region: string, engineId: string): string|null {
  if (engineId.startsWith('projects/')) {
    const match = STRICT_ENGINE_PATH_REGEX.exec(engineId);
    return match && match[1] === region ? engineId : null;
  }
  if (!RESOURCE_ID_REGEX.test(engineId)) {
    return null;
  }
  return `projects/${projectId}/locations/${region}/collections/default_collection/engines/${engineId}`;
}

/** The validated engine a request addresses. */
export interface EngineQuery {
  projectId: string;
  region: string;
  /** The full engine resource name, safe to interpolate into a URL. */
  enginePath: string;
}

/**
 * Whether a query parameter was given exactly once and matches `pattern`. A
 * parameter given more than once arrives as an array, which is rejected.
 */
function isValidParam(value: unknown, pattern: RegExp): value is string {
  return typeof value === 'string' && pattern.test(value);
}

/**
 * Validates the `projectId`, `region` and `engineId` query parameters of a
 * request that addresses one engine.
 *
 * @param query The request's query parameters.
 * @return The validated engine, or the reason the request is invalid, suitable
 *     for a 400 response.
 */
export function parseEngineQuery(query: Request['query']): EngineQuery|
    {error: string} {
  const {projectId, region, engineId} = query ?? {};
  if (!isValidParam(projectId, PROJECT_ID_REGEX)) {
    return {error: 'Invalid or missing projectId parameter.'};
  }
  if (!isValidParam(region, REGION_REGEX)) {
    return {error: 'Invalid or missing region parameter.'};
  }
  const enginePath = typeof engineId === 'string' ?
      resolveEnginePath(projectId, region, engineId) :
      null;
  if (!enginePath) {
    return {error: 'Invalid or missing engineId parameter.'};
  }
  return {projectId, region, enginePath};
}

/**
 * Creates the Express router for proxying requests to Discovery Engine and Vertex AI.
 */
export function createProxyRouter(config: Config, refreshTokenStore?: RefreshTokenStore): Router {
  const router = Router();
  const authMiddleware = createAuthenticateMiddleware(config, refreshTokenStore);

  // Apply auth middleware to protect these proxy endpoints
  router.use('/api/v1/*', authMiddleware);

  // 1. POST /api/v1/assist (Discovery Engine streamAssist proxy)
  router.post('/api/v1/assist', async (req: Request, res: Response) => {
    const {selectedEngine, region, body} = req.body as {
      selectedEngine: string;
      region: string;
      body: unknown;
    };

    if (!selectedEngine || !ENGINE_PATH_REGEX.test(selectedEngine)) {
      res.status(400).send('Invalid or missing selectedEngine parameter.');
      return;
    }

    if (!region || !REGION_REGEX.test(region)) {
      res.status(400).send('Invalid or missing region parameter.');
      return;
    }

    const url = `https://${discoveryEngineBaseUrl(region)}/v1/${selectedEngine}/assistants/default_assistant:streamAssist`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${req.session?.token.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        res.status(response.status).send(errorText);
        return;
      }

      res.setHeader('Content-Type', response.headers.get('Content-Type') || 'application/json');
      if (response.headers.has('Transfer-Encoding')) {
        res.setHeader('Transfer-Encoding', response.headers.get('Transfer-Encoding')!);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        res.status(500).send('Response body is not readable.');
        return;
      }

      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
    } catch (err) {
      res.status(500).send(`Proxy request failed: ${(err as Error).message}`);
    }
  });

  // 2. POST /api/v1/score (Vertex AI generateContent proxy)
  router.post('/api/v1/score', async (req: Request, res: Response) => {
    const {projectId, region, model, body} = req.body as {
      projectId: string;
      region: string;
      model: string;
      body: any;
    };

    if (!projectId) {
      res.status(400).send('Missing projectId parameter.');
      return;
    }

    if (!region || !REGION_REGEX.test(region)) {
      res.status(400).send('Invalid or missing region parameter.');
      return;
    }

    if (!model) {
      res.status(400).send('Missing model parameter.');
      return;
    }

    try {
      const auth = new google.auth.OAuth2();
      auth.setCredentials({ access_token: req.session?.token.access_token || '' });

      const aiplatform = google.aiplatform({
        version: 'v1',
        auth,
        rootUrl: `https://${vertexAiBaseUrl(region)}/`,
      });
      const response = await aiplatform.projects.locations.publishers.models.generateContent({
        model: `projects/${projectId}/locations/${region}/publishers/google/models/${model}`,
        requestBody: body,
      }, {
        headers: {
          'x-goog-user-project': projectId,
        },
      });

      res.json(response.data);
    } catch (err: any) {
      res.status(err.response?.status || 500).send(`Proxy request failed: ${err.message}`);
    }
  });

  // 3. GET /api/v1/engines (Discovery Engine list engines proxy)
  router.get('/api/v1/engines', async (req: Request, res: Response) => {
    const projectId = req.query['projectId'] as string;
    const region = req.query['region'] as string;

    if (!projectId) {
      res.status(400).send('Missing projectId parameter.');
      return;
    }

    if (!region || !REGION_REGEX.test(region)) {
      res.status(400).send('Invalid or missing region parameter.');
      return;
    }

    try {
      const auth = new google.auth.OAuth2();
      auth.setCredentials({ access_token: req.session?.token.access_token || '' });

      const discoveryengine = google.discoveryengine({
        version: 'v1alpha',
        auth,
        rootUrl: `https://${discoveryEngineBaseUrl(region)}/`,
      });

      const response = await discoveryengine.projects.locations.collections.engines.list({
        parent: `projects/${projectId}/locations/${region}/collections/default_collection`,
      }, {
        headers: {
          'x-goog-user-project': projectId
        }
      });

      res.json(response.data);
    } catch (err: any) {
      res.status(err.response?.status || 500).send(`Proxy request failed: ${err.message}`);
    }
  });

  // 4. GET /api/v1/widget-config (Discovery Engine widget config proxy)
  router.get('/api/v1/widget-config', async (req: Request, res: Response) => {
    const projectId = req.query['projectId'] as string;
    const region = req.query['region'] as string;
    const engineId = req.query['engineId'] as string;

    if (!projectId) {
      res.status(400).send('Missing projectId parameter.');
      return;
    }

    if (!region || !REGION_REGEX.test(region)) {
      res.status(400).send('Invalid or missing region parameter.');
      return;
    }

    if (!engineId) {
      res.status(400).send('Missing engineId parameter.');
      return;
    }

    try {
      const auth = new google.auth.OAuth2();
      auth.setCredentials({ access_token: req.session?.token.access_token || '' });

      const discoveryengine = google.discoveryengine({
        version: 'v1alpha',
        auth,
        rootUrl: `https://${discoveryEngineBaseUrl(region)}/`,
      });
      const enginePath = engineId.startsWith('projects/')
        ? engineId
        : `projects/${projectId}/locations/${region}/collections/default_collection/engines/${engineId}`;
      const name = `${enginePath}/widgetConfigs/default_search_widget_config`;

      const response = await discoveryengine.projects.locations.collections.engines.widgetConfigs.get({
        name,
      }, {
        headers: {
          'x-goog-user-project': projectId
        }
      });

      res.json(response.data);
    } catch (err: any) {
      res.status(err.response?.status || 500).send(`Proxy request failed: ${err.message}`);
    }
  });

  // 5. GET /api/v1/trace (Cloud Trace API lookup by assistToken)
  router.get('/api/v1/trace', async (req: Request, res: Response) => {
    const projectId = req.query['projectId'];
    const assistToken = req.query['assistToken'];

    if (
      typeof projectId !== 'string' ||
      typeof assistToken !== 'string' ||
      !projectId ||
      !assistToken
    ) {
      res.status(400).send('Missing projectId or assistToken parameter.');
      return;
    }

    try {
      const auth = new google.auth.OAuth2();
      auth.setCredentials({ access_token: req.session?.token?.access_token || '' });

      const filter = encodeURIComponent(`+gemini_enterprise.assist_token:${assistToken}`);
      const url = `https://cloudtrace.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/traces?filter=${filter}&pageSize=1`;

      const response = await auth.request<{traces?: Array<{traceId?: string}>}>({
        url,
        headers: {
          'x-goog-user-project': projectId,
        },
      });

      const traceId = response.data?.traces?.[0]?.traceId;
      res.json({traceId});
    } catch (err) {
      const status =
        typeof err === 'object' &&
        err !== null &&
        'response' in err &&
        typeof err.response === 'object' &&
        err.response !== null &&
        'status' in err.response &&
        typeof err.response.status === 'number'
          ? err.response.status
          : 500;
      const message = err instanceof Error ? err.message : String(err);
      res.status(status).send(`Proxy request failed: ${message}`);
    }
  });

  // 6. GET /api/v1/agents (Discovery Engine list agents proxy)
  //
  // This uses a raw fetch rather than the generated `googleapis` client,
  // because the pinned client does not expose the
  // `engines.assistants.agents` resource.
  router.get('/api/v1/agents', async (req: Request, res: Response) => {
    const engine = parseEngineQuery(req.query);
    if ('error' in engine) {
      res.status(400).send(engine.error);
      return;
    }
    const {projectId, region, enginePath} = engine;

    const accessToken = req.session?.token?.access_token;
    if (!accessToken) {
      res.status(401).send('Not authenticated.');
      return;
    }

    const url = `https://${discoveryEngineBaseUrl(region)}/v1alpha/${enginePath}/assistants/default_assistant/agents?pageSize=${MAX_AGENT_PAGE_SIZE}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'x-goog-user-project': projectId,
        },
      });

      if (!response.ok) {
        res.status(response.status).send(await response.text());
        return;
      }

      res.json(await response.json());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).send(`Proxy request failed: ${message}`);
    }
  });

  return router;
}


