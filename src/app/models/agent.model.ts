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
 * An agent published under an engine's assistant, as returned by ListAgents.
 * Only the fields the studio needs to offer a choice are modelled.
 */
export interface Agent {
  /**
   * Resource name, of the form
   * `projects/{p}/locations/{l}/collections/{c}/engines/{e}/assistants/{a}/agents/{agent}`.
   * The resource has no separate id field; the bare id is the last segment.
   */
  name: string;
  displayName?: string;
  description?: string;
  /**
   * The lifecycle state, such as `ENABLED` or `DEPLOYING`. Kept as a plain
   * string rather than a copy of the API enum: the enum grows, and a local copy
   * would go stale. Only the states in `UNRUNNABLE_AGENT_STATES` are
   * interpreted.
   */
  state?: string;
}

/** Response of `engines.assistants.agents.list`. */
export interface ListAgentsResponse {
  agents?: Agent[];
  nextPageToken?: string;
}

/**
 * States in which an agent cannot answer a query: it has been configured but
 * never deployed, it is still being built, or its build failed. Offering one
 * of these would put an option in the picker that fails every row of the run.
 *
 * This is a deny-list rather than an allow-list so that it cannot go stale in
 * the harmful direction: a state the API adds later is treated as runnable, and
 * the agent stays visible, rather than being silently hidden.
 *
 * `PRIVATE`, `DISABLED` and `SUSPENDED` are deliberately absent: they narrow who
 * may use the agent rather than break it. Owners can always run agents in
 * these states; in Enterprise edition, admins can also run `DISABLED` and
 * `SUSPENDED` ones. ListAgents does not filter by who may run an agent, so the
 * picker can offer an agent the caller cannot run; a run against it fails with
 * a permission error that names the cause.
 */
const UNRUNNABLE_AGENT_STATES: ReadonlySet<string> = new Set([
  'CONFIGURED',
  'CREATING',
  'CREATION_FAILED',
  'DEPLOYING',
  'DEPLOYMENT_FAILED',
]);

/**
 * Whether an agent can serve a query, and so belongs in the picker. An absent
 * or unrecognized state counts as runnable: the API has not said otherwise,
 * and hiding an agent the user can see in the console is worse than surfacing
 * the run's real error. An agent whose name yields no agent ID is excluded,
 * since a run could not address it.
 */
export function isRunnableAgent(agent: Agent): boolean {
  return !!agentIdFromResourceName(agent.name) &&
      !UNRUNNABLE_AGENT_STATES.has(agent.state ?? '');
}

/**
 * Extracts the bare agent id that `StreamAssistRequest.agentsSpec` expects from
 * a full agent resource name. A value that is already a bare id is returned
 * unchanged.
 * @param resourceName The agent resource name, or a bare agent id.
 * @returns The last path segment, or the empty string when there is none.
 */
export function agentIdFromResourceName(resourceName: string|undefined):
    string {
  if (!resourceName) {
    return '';
  }
  const segments = resourceName.split('/').filter(segment => segment !== '');
  return segments.length > 0 ? segments[segments.length - 1] : '';
}

/** The label shown for an agent, falling back to its id when it has no name. */
export function agentDisplayName(agent: Agent): string {
  return agent.displayName || agentIdFromResourceName(agent.name);
}
