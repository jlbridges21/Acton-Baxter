export type BaxterChannel = "web" | "slack";
export type BaxterConfidence = "high" | "medium" | "low";
export type BaxterMessageRole = "user" | "assistant" | "system";
export type BaxterConversationStatus = "active" | "closed" | "error";
export type BaxterLlmProviderName = "openai";

export type BaxterSourceReference = {
  title: string;
  sourceName: string | null;
  category: string | null;
  sourceUrl: string | null;
  citationLabel: string;
};

export type BaxterQuestionInput = {
  question: string;
  userId: string;
  userName?: string | null;
  channel: BaxterChannel;
  conversationId?: string | null;
};

export type BaxterAnswer = {
  answer: string;
  sources: BaxterSourceReference[];
  confidence: BaxterConfidence;
  insufficientKnowledge: boolean;
  conversationId: string;
  messageId?: string;
};

export type BaxterContextItem = {
  number: number;
  id: string;
  title: string;
  summary: string | null;
  contentExcerpt: string;
  category: string;
  tags: string[];
  sourceName: string | null;
  sourceUrl: string | null;
  updatedAt: string;
  citationLabel: string;
  relevanceScore: number;
};

export type BaxterLLMInput = {
  question: string;
  contextItems: BaxterContextItem[];
  userName?: string | null;
  channel: BaxterChannel;
};

export type BaxterLLMOutput = {
  answer: string;
  usedSourceNumbers: number[];
  confidence: BaxterConfidence;
  insufficientKnowledge: boolean;
  modelProvider: BaxterLlmProviderName;
  modelName: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  latencyMs?: number | null;
};

export type BaxterConversation = {
  id: string;
  channel: BaxterChannel;
  external_thread_id: string | null;
  user_id: string | null;
  external_user_id: string | null;
  user_display_name: string | null;
  status: BaxterConversationStatus;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  metadata: Record<string, unknown>;
};

export type BaxterMessage = {
  id: string;
  conversation_id: string;
  role: BaxterMessageRole;
  content: string;
  insufficient_knowledge: boolean;
  confidence: BaxterConfidence | null;
  model_provider: string | null;
  model_name: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number | null;
  error_code: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
};
