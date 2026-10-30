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

import {Agent, agentDisplayName, agentIdFromResourceName, isRunnableAgent} from './agent.model';

const AGENT_PATH =
    'projects/p/locations/global/collections/default_collection/engines/e/assistants/default_assistant/agents/my-agent';

/** Builds an agent with the given overrides on top of a runnable default. */
function agent(overrides: Partial<Agent> = {}): Agent {
  return {
    name: AGENT_PATH,
    displayName: 'My Agent',
    state: 'ENABLED',
    ...overrides
  };
}

describe('agentIdFromResourceName', () => {
  it('should take the last segment of a full resource name', () => {
    expect(agentIdFromResourceName(AGENT_PATH)).toBe('my-agent');
  });

  it('should return a bare id unchanged', () => {
    expect(agentIdFromResourceName('my-agent')).toBe('my-agent');
  });

  it('should return the empty string for an empty or undefined name', () => {
    expect(agentIdFromResourceName('')).toBe('');
    expect(agentIdFromResourceName(undefined)).toBe('');
    expect(agentIdFromResourceName('///')).toBe('');
  });

  it('should ignore a trailing slash rather than yield an empty id', () => {
    expect(agentIdFromResourceName(`${AGENT_PATH}/`)).toBe('my-agent');
  });
});

describe('isRunnableAgent', () => {
  it('should offer agents that can serve a query', () => {
    const states = ['ENABLED', 'PRIVATE', 'DISABLED', 'SUSPENDED'] as const;
    expect(states.filter(state => !isRunnableAgent(agent({state}))))
        .toEqual([]);
  });

  it('should exclude agents that are undeployed, building or failed', () => {
    const states = [
      'CONFIGURED', 'CREATING', 'CREATION_FAILED', 'DEPLOYING',
      'DEPLOYMENT_FAILED'
    ] as const;
    expect(states.filter(state => isRunnableAgent(agent({state}))))
        .toEqual([]);
  });

  it('should offer an agent whose state the API did not report', () => {
    expect(isRunnableAgent(agent({state: undefined}))).toBeTrue();
    expect(isRunnableAgent(agent({state: 'STATE_UNSPECIFIED'}))).toBeTrue();
  });

  it('should exclude an agent with no resource name, which cannot be selected',
     () => {
       expect(isRunnableAgent(agent({name: ''}))).toBeFalse();
     });

  it('should exclude an agent whose name yields no agent ID', () => {
    expect(isRunnableAgent(agent({name: '///'}))).toBeFalse();
  });
});

describe('agentDisplayName', () => {
  it('should prefer the display name', () => {
    expect(agentDisplayName(agent())).toBe('My Agent');
  });

  it('should fall back to the agent id when there is no display name', () => {
    expect(agentDisplayName(agent({displayName: undefined}))).toBe('my-agent');
  });
});
