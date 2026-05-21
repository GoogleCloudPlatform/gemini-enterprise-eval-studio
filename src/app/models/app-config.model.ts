/**
 * Configuration for the evaluation application.
 */
export interface AppConfig {
  gCloudToken: string;
  projectId: string;
  region: string;
  selectedEngine: string;
  selectedModel: string;
  geminiApiKey: string;
  autoRaterInstruction: string;
}

/**
 * Represents an evaluation engine.
 */
export interface Engine {
  name: string;
  displayName: string;
  modelConfigs?: {[key: string]: string};
}
