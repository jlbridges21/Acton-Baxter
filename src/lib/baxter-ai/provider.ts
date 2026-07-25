import "server-only";

import type { BaxterLLMInput, BaxterLLMOutput, BaxterLlmProviderName } from "./types";

export interface BaxterLLMProvider {
  readonly key: BaxterLlmProviderName;
  readonly name: string;
  generateAnswer(input: BaxterLLMInput): Promise<BaxterLLMOutput>;
}
