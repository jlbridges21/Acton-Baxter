# Baxter AI architecture

## Purpose

Baxter answers Acton employees from **approved** Knowledge Base entries. Prompt 3 adds the shared answering service and a dashboard-only web chat. Prompt 4 will reuse the same service for Slack.

## Shared service

`src/lib/baxter-ai/`

- `answer.ts` — `answerBaxterQuestion()` orchestration
- `context.ts` — calls `searchApprovedKnowledge()`
- `citations.ts` — maps model `[n]` citations to real retrieved records
- `openai-provider.ts` — current LLM provider (HTTP chat/completions)
- `provider.ts` — `BaxterLLMProvider` interface
- `conversations.ts` — conversation/message persistence
- `prompts.ts` — grounding rules

Web UI calls `POST /api/baxter/chat` only. It never calls OpenAI directly.

## Provider abstraction

```ts
interface BaxterLLMProvider {
  generateAnswer(input: BaxterLLMInput): Promise<BaxterLLMOutput>;
}
```

Current: `OpenAIBaxterProvider` (`BAXTER_LLM_PROVIDER=openai`).

Future: Anthropic (not implemented). Setting `BAXTER_LLM_PROVIDER=anthropic` fails safely.

Model selection: `BAXTER_OPENAI_MODEL` (falls back to `OPENAI_MODEL`, default `gpt-4o-mini`).

## Knowledge grounding flow

1. Validate/normalize the question.
2. `searchApprovedKnowledge()` — approved + internal only.
3. Build numbered context items (title, summary, excerpt, source metadata).
4. Call the LLM with a strict system prompt.
5. Map `usedSourceNumbers` to real KB records (never trust model titles/URLs).
6. Persist conversation, messages, and source links.

Draft, archived, and admin-only entries are never included.

## Conversation logging

Migration `007_baxter_conversations.sql` creates:

- `baxter_conversations`
- `baxter_messages`
- `baxter_message_sources`

RLS: users read/write their own web conversations; admins can read all for future diagnostics. Service-role writes are used by the server answer path.

## Safety

- No invented procedures/policies/RACI/customer facts
- Insufficient knowledge admitted clearly
- Employee-facing errors never include provider stack traces
- Chat can be disabled with `BAXTER_CHAT_ENABLED=false`
- Chat launcher appears only on `/`

## Planned Slack reuse (Prompt 4)

Slack handlers should call `answerBaxterQuestion({ channel: "slack", ... })` with the same retrieval, citations, and logging. No Slack conversational bot exists yet.
