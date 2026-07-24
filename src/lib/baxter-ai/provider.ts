import "server-only";

import type { BaxterLLMInput, BaxterLLMOutput, BaxterLlmProviderName } from "./types";

export interface BaxterLLMProvider {
  readonly key: BaxterLlmProviderName;
  readonly name: string;
  generateAnswer(input: BaxterLLMInput): Promise<BaxterLLMOutput>;
}

/**
 * AnthropicBaxterProvider is planned for a later prompt.
 * Do not implement a fake Anthropic integration here.
 */
export type FutureAnthropicBaxterProvider = never;
