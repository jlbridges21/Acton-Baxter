/**
 * Survey persistence — service-role reads and writes; memory for tests/mock.
 * Route handlers enforce who may edit; this module only stores.
 */

import "server-only";

import { randomUUID } from "node:crypto";
import { nanoid } from "nanoid";
import { createServiceClient } from "@/lib/supabase/admin";
import { getEnv } from "@/lib/env";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { getReportStore } from "@/lib/research/report-store";
import type { CreateSurveyInput, SaveSurveyInput } from "./schemas";
import type {
  Survey,
  SurveyAnswer,
  SurveyDetail,
  SurveyDisplayMode,
  SurveyIdentityMode,
  SurveyOption,
  SurveyQuestion,
  SurveyQuestionType,
  SurveyResponse,
  SurveySummary,
} from "./types";

type SurveyRow = {
  id: string;
  title: string;
  description: string | null;
  public_token: string;
  display_mode: SurveyDisplayMode;
  identity_mode: SurveyIdentityMode;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type QuestionRow = {
  id: string;
  survey_id: string;
  position: number;
  prompt: string;
  help_text: string | null;
  type: SurveyQuestionType;
  required: boolean;
  options: SurveyOption[];
  archived_at: string | null;
  created_at: string;
};

type ResponseRow = {
  id: string;
  survey_id: string;
  submitted_at: string;
  respondent_user_id: string | null;
  respondent_name: string | null;
  respondent_email: string | null;
};

type AnswerRow = {
  id: string;
  response_id: string;
  question_id: string;
  rating_value: number | null;
  text_value: string | null;
  option_ids: string[] | null;
};

type MemoryState = {
  surveys: Map<string, SurveyRow>;
  questions: Map<string, QuestionRow>;
  responses: Map<string, ResponseRow>;
  answers: Map<string, AnswerRow>;
};

const globalMemory = globalThis as typeof globalThis & {
  __baxterSurveys?: MemoryState;
};

function emptyMemory(): MemoryState {
  return {
    surveys: new Map(),
    questions: new Map(),
    responses: new Map(),
    answers: new Map(),
  };
}

function getMemory(): MemoryState {
  if (!globalMemory.__baxterSurveys) globalMemory.__baxterSurveys = emptyMemory();
  return globalMemory.__baxterSurveys;
}

export function resetSurveyMemoryForTests() {
  globalMemory.__baxterSurveys = emptyMemory();
}

/** Raw stored response rows — tests use this to prove anonymous submissions keep no identity. */
export function getSurveyMemoryForTests(): MemoryState {
  return getMemory();
}

function shouldUseMemory(): boolean {
  try {
    const env = getEnv();
    return Boolean(env.ENABLE_MOCK_RESEARCH) && env.NODE_ENV !== "production";
  } catch {
    return true;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function newToken() {
  return nanoid(21);
}

function newOptionId() {
  return nanoid(10);
}

function dbError(context: string, error: { message: string }): Error {
  return new Error(`[surveys] ${context}: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function mapSurvey(row: SurveyRow, names: Map<string, string>): Survey {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    publicToken: row.public_token,
    displayMode: row.display_mode,
    identityMode: row.identity_mode,
    createdBy: row.created_by,
    createdByName: names.get(row.created_by) ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapQuestion(row: QuestionRow): SurveyQuestion {
  return {
    id: row.id,
    surveyId: row.survey_id,
    position: row.position,
    prompt: row.prompt,
    helpText: row.help_text,
    type: row.type,
    required: row.required,
    options: Array.isArray(row.options) ? row.options : [],
    archivedAt: row.archived_at,
  };
}

function mapAnswer(row: AnswerRow): SurveyAnswer {
  return {
    questionId: row.question_id,
    ratingValue: row.rating_value,
    textValue: row.text_value,
    optionIds: row.option_ids,
  };
}

function mapResponse(row: ResponseRow, answers: AnswerRow[]): SurveyResponse {
  return {
    id: row.id,
    surveyId: row.survey_id,
    submittedAt: row.submitted_at,
    respondentUserId: row.respondent_user_id,
    respondentName: row.respondent_name,
    respondentEmail: row.respondent_email,
    answers: answers.filter((a) => a.response_id === row.id).map(mapAnswer),
  };
}

function sortQuestions(rows: QuestionRow[]): QuestionRow[] {
  return [...rows].sort((a, b) => {
    if (Boolean(a.archived_at) !== Boolean(b.archived_at)) return a.archived_at ? 1 : -1;
    return a.position - b.position;
  });
}

async function profileNames(ids: string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  const names = new Map<string, string>();
  if (unique.length === 0) return names;
  if (shouldUseMemory()) {
    const store = getReportStore();
    for (const id of unique) {
      const profile = await store.getProfile(id);
      if (profile?.full_name) names.set(id, profile.full_name);
    }
    return names;
  }
  const { data, error } = await createServiceClient()
    .from("profiles")
    .select("id, full_name")
    .in("id", unique);
  if (error) {
    console.warn("[surveys] creator names unavailable:", error.message);
    return names;
  }
  for (const row of (data ?? []) as Array<{ id: string; full_name: string | null }>) {
    if (row.full_name) names.set(row.id, row.full_name);
  }
  return names;
}

// ---------------------------------------------------------------------------
// Low-level reads
// ---------------------------------------------------------------------------

async function loadSurveyRow(id: string): Promise<SurveyRow | null> {
  if (shouldUseMemory()) {
    const row = getMemory().surveys.get(id);
    return row && !row.deleted_at ? row : null;
  }
  const { data, error } = await createServiceClient()
    .from("surveys")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw dbError("load survey", error);
  return (data as SurveyRow | null) ?? null;
}

async function loadSurveyRowByToken(token: string): Promise<SurveyRow | null> {
  if (shouldUseMemory()) {
    for (const row of getMemory().surveys.values()) {
      if (row.public_token === token && !row.deleted_at) return row;
    }
    return null;
  }
  const { data, error } = await createServiceClient()
    .from("surveys")
    .select("*")
    .eq("public_token", token)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw dbError("load survey by token", error);
  return (data as SurveyRow | null) ?? null;
}

async function loadQuestionRows(surveyId: string): Promise<QuestionRow[]> {
  if (shouldUseMemory()) {
    return sortQuestions(
      Array.from(getMemory().questions.values()).filter((q) => q.survey_id === surveyId),
    );
  }
  const { data, error } = await createServiceClient()
    .from("survey_questions")
    .select("*")
    .eq("survey_id", surveyId);
  if (error) throw dbError("load questions", error);
  return sortQuestions((data ?? []) as QuestionRow[]);
}

async function loadResponseRows(surveyId: string): Promise<ResponseRow[]> {
  if (shouldUseMemory()) {
    return Array.from(getMemory().responses.values()).filter((r) => r.survey_id === surveyId);
  }
  const { data, error } = await createServiceClient()
    .from("survey_responses")
    .select("*")
    .eq("survey_id", surveyId)
    .order("submitted_at", { ascending: false });
  if (error) throw dbError("load responses", error);
  return (data ?? []) as ResponseRow[];
}

async function loadAnswerRows(responseIds: string[]): Promise<AnswerRow[]> {
  if (responseIds.length === 0) return [];
  if (shouldUseMemory()) {
    const ids = new Set(responseIds);
    return Array.from(getMemory().answers.values()).filter((a) => ids.has(a.response_id));
  }
  const supabase = createServiceClient();
  const out: AnswerRow[] = [];
  for (let i = 0; i < responseIds.length; i += 200) {
    const { data, error } = await supabase
      .from("survey_answers")
      .select("*")
      .in("response_id", responseIds.slice(i, i + 200));
    if (error) throw dbError("load answers", error);
    out.push(...((data ?? []) as AnswerRow[]));
  }
  return out;
}

async function answeredQuestionIds(questionIds: string[]): Promise<Set<string>> {
  const answered = new Set<string>();
  if (questionIds.length === 0) return answered;
  if (shouldUseMemory()) {
    const ids = new Set(questionIds);
    for (const a of getMemory().answers.values()) {
      if (ids.has(a.question_id)) answered.add(a.question_id);
    }
    return answered;
  }
  const supabase = createServiceClient();
  await Promise.all(
    questionIds.map(async (id) => {
      const { count, error } = await supabase
        .from("survey_answers")
        .select("id", { count: "exact", head: true })
        .eq("question_id", id);
      if (error) throw dbError("count answers", error);
      if ((count ?? 0) > 0) answered.add(id);
    }),
  );
  return answered;
}

async function buildDetail(row: SurveyRow): Promise<SurveyDetail> {
  const [questions, responses, names] = await Promise.all([
    loadQuestionRows(row.id),
    loadResponseRows(row.id),
    profileNames([row.created_by]),
  ]);
  const answered = await answeredQuestionIds(questions.map((q) => q.id));
  return {
    ...mapSurvey(row, names),
    questions: questions.map(mapQuestion),
    responseCount: responses.length,
    answeredQuestionIds: Array.from(answered),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function listSurveys(): Promise<SurveySummary[]> {
  let surveys: SurveyRow[];
  let responses: Array<Pick<ResponseRow, "survey_id" | "submitted_at">>;
  let questions: Array<Pick<QuestionRow, "survey_id" | "archived_at">>;

  if (shouldUseMemory()) {
    const mem = getMemory();
    surveys = Array.from(mem.surveys.values()).filter((s) => !s.deleted_at);
    responses = Array.from(mem.responses.values());
    questions = Array.from(mem.questions.values());
  } else {
    const supabase = createServiceClient();
    const surveyResult = await supabase
      .from("surveys")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (surveyResult.error) throw dbError("list surveys", surveyResult.error);
    surveys = (surveyResult.data ?? []) as SurveyRow[];
    const ids = surveys.map((s) => s.id);
    if (ids.length === 0) {
      responses = [];
      questions = [];
    } else {
      const [responseResult, questionResult] = await Promise.all([
        supabase.from("survey_responses").select("survey_id, submitted_at").in("survey_id", ids),
        supabase.from("survey_questions").select("survey_id, archived_at").in("survey_id", ids),
      ]);
      if (responseResult.error) throw dbError("list response counts", responseResult.error);
      if (questionResult.error) throw dbError("list question counts", questionResult.error);
      responses = (responseResult.data ?? []) as typeof responses;
      questions = (questionResult.data ?? []) as typeof questions;
    }
  }

  const names = await profileNames(surveys.map((s) => s.created_by));
  const stats = new Map<string, { count: number; last: string | null; questions: number }>();
  for (const s of surveys) stats.set(s.id, { count: 0, last: null, questions: 0 });
  for (const r of responses) {
    const stat = stats.get(r.survey_id);
    if (!stat) continue;
    stat.count += 1;
    if (!stat.last || r.submitted_at > stat.last) stat.last = r.submitted_at;
  }
  for (const q of questions) {
    const stat = stats.get(q.survey_id);
    if (stat && !q.archived_at) stat.questions += 1;
  }

  return surveys
    .map((row) => {
      const stat = stats.get(row.id)!;
      return {
        ...mapSurvey(row, names),
        responseCount: stat.count,
        lastResponseAt: stat.last,
        questionCount: stat.questions,
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getSurvey(id: string): Promise<SurveyDetail> {
  const row = await loadSurveyRow(id);
  if (!row) throw new NotFoundError("Survey not found");
  return buildDetail(row);
}

export async function getSurveyByToken(token: string): Promise<SurveyDetail | null> {
  if (!token || token.length > 64) return null;
  const row = await loadSurveyRowByToken(token);
  return row ? buildDetail(row) : null;
}

export async function createSurvey(
  input: CreateSurveyInput & { actorId: string },
): Promise<Survey> {
  const timestamp = nowIso();
  const row: SurveyRow = {
    id: randomUUID(),
    title: input.title,
    description: input.description ?? null,
    public_token: newToken(),
    display_mode: "all_on_one_page",
    identity_mode: "name_optional",
    created_by: input.actorId,
    created_at: timestamp,
    updated_at: timestamp,
    deleted_at: null,
  };
  if (shouldUseMemory()) {
    getMemory().surveys.set(row.id, row);
  } else {
    const { error } = await createServiceClient().from("surveys").insert(row);
    if (error) throw dbError("create survey", error);
  }
  return mapSurvey(row, await profileNames([row.created_by]));
}

/**
 * Save the whole survey graph. Removed questions with answers are archived;
 * removed questions without answers are deleted. A question with answers
 * cannot change type.
 */
export async function saveSurvey(id: string, input: SaveSurveyInput): Promise<SurveyDetail> {
  const row = await loadSurveyRow(id);
  if (!row) throw new NotFoundError("Survey not found");

  const existing = await loadQuestionRows(id);
  const existingById = new Map(existing.map((q) => [q.id, q]));
  const answered = await answeredQuestionIds(existing.map((q) => q.id));

  for (const q of input.questions) {
    const prior = existingById.get(q.id);
    if (prior && !prior.archived_at && prior.type !== q.type && answered.has(q.id)) {
      throw new ValidationError(
        `“${prior.prompt}” already has responses, so its type can't change. Add a new question instead.`,
      );
    }
  }

  const timestamp = nowIso();
  const keptIds = new Set<string>();
  const upserts: QuestionRow[] = input.questions.map((q, index) => {
    const prior = existingById.get(q.id);
    const reuse = prior && !prior.archived_at;
    const questionId = reuse ? q.id : randomUUID();
    keptIds.add(questionId);
    return {
      id: questionId,
      survey_id: id,
      position: index,
      prompt: q.prompt,
      help_text: q.helpText ?? null,
      type: q.type,
      required: q.required,
      options: q.options,
      archived_at: null,
      created_at: reuse ? prior.created_at : timestamp,
    };
  });

  const removed = existing.filter((q) => !q.archived_at && !keptIds.has(q.id));
  const toArchive = removed.filter((q) => answered.has(q.id)).map((q) => q.id);
  const toDelete = removed.filter((q) => !answered.has(q.id)).map((q) => q.id);

  const surveyPatch = {
    title: input.title,
    description: input.description ?? null,
    display_mode: input.displayMode,
    identity_mode: input.identityMode,
    updated_at: timestamp,
  };

  if (shouldUseMemory()) {
    const mem = getMemory();
    mem.surveys.set(id, { ...row, ...surveyPatch });
    for (const q of upserts) mem.questions.set(q.id, q);
    for (const qid of toArchive) {
      const q = mem.questions.get(qid);
      if (q) mem.questions.set(qid, { ...q, archived_at: timestamp });
    }
    for (const qid of toDelete) mem.questions.delete(qid);
  } else {
    const supabase = createServiceClient();
    const { error: surveyError } = await supabase.from("surveys").update(surveyPatch).eq("id", id);
    if (surveyError) throw dbError("update survey", surveyError);
    if (upserts.length > 0) {
      const { error } = await supabase
        .from("survey_questions")
        .upsert(upserts, { onConflict: "id" });
      if (error) throw dbError("save questions", error);
    }
    if (toArchive.length > 0) {
      const { error } = await supabase
        .from("survey_questions")
        .update({ archived_at: timestamp })
        .in("id", toArchive)
        .eq("survey_id", id);
      if (error) throw dbError("archive questions", error);
    }
    if (toDelete.length > 0) {
      const { error } = await supabase
        .from("survey_questions")
        .delete()
        .in("id", toDelete)
        .eq("survey_id", id);
      if (error) throw dbError("delete questions", error);
    }
  }

  return getSurvey(id);
}

export async function softDeleteSurvey(id: string): Promise<void> {
  const row = await loadSurveyRow(id);
  if (!row) throw new NotFoundError("Survey not found");
  const timestamp = nowIso();
  if (shouldUseMemory()) {
    getMemory().surveys.set(id, { ...row, deleted_at: timestamp, updated_at: timestamp });
    return;
  }
  const { error } = await createServiceClient()
    .from("surveys")
    .update({ deleted_at: timestamp })
    .eq("id", id);
  if (error) throw dbError("delete survey", error);
}

export async function duplicateSurvey(id: string, actorId: string): Promise<Survey> {
  const source = await getSurvey(id);
  const copy = await createSurvey({
    title: `Copy of ${source.title}`.slice(0, 200),
    description: source.description,
    actorId,
  });
  const questions = source.questions
    .filter((q) => !q.archivedAt)
    .map((q) => ({
      id: randomUUID(),
      prompt: q.prompt,
      helpText: q.helpText,
      type: q.type,
      required: q.required,
      options: q.options.map((o) => ({ id: newOptionId(), label: o.label })),
    }));
  await saveSurvey(copy.id, {
    title: copy.title,
    description: copy.description,
    displayMode: source.displayMode,
    identityMode: source.identityMode,
    questions,
  });
  return { ...copy, displayMode: source.displayMode, identityMode: source.identityMode };
}

/** Newest first. */
export async function listSurveyResponses(surveyId: string): Promise<SurveyResponse[]> {
  const responses = await loadResponseRows(surveyId);
  const answers = await loadAnswerRows(responses.map((r) => r.id));
  return responses
    .map((r) => mapResponse(r, answers))
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
}

export async function insertSurveyResponse(input: {
  surveyId: string;
  respondentUserId: string | null;
  respondentName: string | null;
  respondentEmail: string | null;
  answers: SurveyAnswer[];
}): Promise<{ id: string }> {
  const response: ResponseRow = {
    id: randomUUID(),
    survey_id: input.surveyId,
    submitted_at: nowIso(),
    respondent_user_id: input.respondentUserId,
    respondent_name: input.respondentName,
    respondent_email: input.respondentEmail,
  };
  const answers: AnswerRow[] = input.answers.map((a) => ({
    id: randomUUID(),
    response_id: response.id,
    question_id: a.questionId,
    rating_value: a.ratingValue,
    text_value: a.textValue,
    option_ids: a.optionIds,
  }));

  if (shouldUseMemory()) {
    const mem = getMemory();
    mem.responses.set(response.id, response);
    for (const a of answers) mem.answers.set(a.id, a);
    return { id: response.id };
  }

  const supabase = createServiceClient();
  const { error } = await supabase.from("survey_responses").insert(response);
  if (error) throw dbError("insert response", error);
  if (answers.length > 0) {
    const { error: answerError } = await supabase.from("survey_answers").insert(answers);
    if (answerError) {
      await supabase.from("survey_responses").delete().eq("id", response.id);
      throw dbError("insert answers", answerError);
    }
  }
  return { id: response.id };
}

export async function deleteSurveyResponse(surveyId: string, responseId: string): Promise<void> {
  if (shouldUseMemory()) {
    const mem = getMemory();
    const row = mem.responses.get(responseId);
    if (!row || row.survey_id !== surveyId) throw new NotFoundError("Response not found");
    mem.responses.delete(responseId);
    for (const [id, a] of mem.answers) {
      if (a.response_id === responseId) mem.answers.delete(id);
    }
    return;
  }
  const { data, error } = await createServiceClient()
    .from("survey_responses")
    .delete()
    .eq("id", responseId)
    .eq("survey_id", surveyId)
    .select("id");
  if (error) throw dbError("delete response", error);
  if (!data || data.length === 0) throw new NotFoundError("Response not found");
}
