export type BaxterChannel = "web" | "slack";
export type BaxterConfidence = "high" | "medium" | "low";
export type BaxterMessageRole = "user" | "assistant" | "system";
export type BaxterConversationStatus = "active" | "closed" | "error";
export type BaxterLlmProviderName = "openai";
export type BaxterSourceKind =
  "manual" | "knowledge_entry" | "google_doc" | "google_sheet" | "google_file";

export type BaxterAnswerMode =
  "identity" | "grounded" | "general" | "mixed" | "clarification" | "error";

export type BaxterSourceReference = {
  title: string;
  sourceName: string | null;
  category: string | null;
  sourceUrl: string | null;
  citationLabel: string;
  sourceKind: BaxterSourceKind;
  openLabel: string;
  lastUpdated: string | null;
  relevanceScore: number;
  availability: "available" | "unavailable";
  knowledgeEntryId?: string;
};

export type BaxterQuestionInput = {
  question: string;
  userId: string;
  userName?: string | null;
  channel: BaxterChannel;
  conversationId?: string | null;
  externalThreadId?: string | null;
  externalUserId?: string | null;
};

export type BaxterAnswer = {
  answer: string;
  sources: BaxterSourceReference[];
  confidence: BaxterConfidence;
  insufficientKnowledge: boolean;
  conversationId: string;
  messageId?: string;
  answerMode?: BaxterAnswerMode;
  errorCode?: string | null;
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
  sourceType: string;
  mimeType: string | null;
  updatedAt: string;
  citationLabel: string;
  relevanceScore: number;
};

export type BaxterHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export type BaxterLLMInput = {
  question: string;
  contextItems: BaxterContextItem[];
  userName?: string | null;
  channel: BaxterChannel;
  questionClass?: string;
  identityContext?: string;
  history?: BaxterHistoryMessage[];
};

export type BaxterLLMOutput = {
  answer: string;
  usedSourceNumbers: number[];
  confidence: BaxterConfidence;
  insufficientKnowledge: boolean;
  answerMode: BaxterAnswerMode;
  modelProvider: BaxterLlmProviderName;
  modelName: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  latencyMs?: number | null;
  rawTextFallback?: boolean;
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
