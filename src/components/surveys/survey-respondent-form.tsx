"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  RESPONDENT_EMAIL_FIELD,
  RESPONDENT_NAME_FIELD,
  validateSurveySubmission,
} from "@/lib/surveys/schemas";
import { SURVEY_TEXT_ANSWER_MAX, type PublicSurvey } from "@/lib/surveys/types";
import { cn } from "@/lib/utils";
import { StarRatingInput } from "./star-rating-input";

type Question = PublicSurvey["questions"][number];
type Draft = { ratingValue?: number | null; textValue?: string; optionIds?: string[] };

const IDENTITY_STEP = "__identity";

function buildAnswers(survey: PublicSurvey, drafts: Record<string, Draft>) {
  return survey.questions
    .map((q) => {
      const d = drafts[q.id];
      if (!d) return null;
      return {
        questionId: q.id,
        ratingValue: d.ratingValue ?? null,
        textValue: d.textValue ?? null,
        optionIds: d.optionIds ?? null,
      };
    })
    .filter((a): a is NonNullable<typeof a> => a !== null);
}

export function SurveyRespondentForm({
  survey,
  prefill,
  preview = false,
}: {
  survey: PublicSurvey;
  prefill?: { name: string; email: string } | null;
  preview?: boolean;
}) {
  const anonymous = survey.identityMode === "anonymous";
  const oneAtATime = survey.displayMode === "one_at_a_time";
  const steps = [...(anonymous ? [] : [IDENTITY_STEP]), ...survey.questions.map((q) => q.id)];

  const [name, setName] = useState(anonymous ? "" : (prefill?.name ?? ""));
  const [email, setEmail] = useState(anonymous ? "" : (prefill?.email ?? ""));
  const [website, setWebsite] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function update(questionId: string, next: Draft) {
    setDrafts((prev) => ({ ...prev, [questionId]: { ...prev[questionId], ...next } }));
    setErrors((prev) => {
      if (!prev[questionId]) return prev;
      const copy = { ...prev };
      delete copy[questionId];
      return copy;
    });
  }

  function validate(scope?: string) {
    const onlyQuestionIds =
      scope === undefined ? undefined : scope === IDENTITY_STEP ? [] : [scope];
    return validateSurveySubmission(
      survey,
      { name, email, answers: buildAnswers(survey, drafts) },
      { onlyQuestionIds, skipIdentity: scope !== undefined && scope !== IDENTITY_STEP },
    );
  }

  function focusFirstError(found: Record<string, string>) {
    const identityError = found[RESPONDENT_NAME_FIELD] || found[RESPONDENT_EMAIL_FIELD];
    const first = steps.find((id) => (id === IDENTITY_STEP ? identityError : found[id]));
    if (!first) return;
    if (oneAtATime) {
      setStep(Math.max(0, steps.indexOf(first)));
      return;
    }
    const el = document.getElementById(`survey-field-${first}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function next() {
    const result = validate(steps[step]);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setStep((s) => Math.min(steps.length - 1, s + 1));
  }

  async function submit() {
    setFormError(null);
    const result = validate();
    if (!result.ok) {
      setErrors(result.errors);
      setFormError(result.message);
      focusFirstError(result.errors);
      return;
    }
    setErrors({});
    if (preview) {
      setDone(true);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/public/surveys/${survey.token}/responses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: anonymous ? "" : name,
          email: anonymous ? "" : email,
          website,
          answers: buildAnswers(survey, drafts),
        }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setFormError(json?.error?.message ?? "Your response couldn't be recorded. Try again.");
        return;
      }
      setDone(true);
    } catch {
      setFormError("Your response couldn't be recorded. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function startOver() {
    setDrafts({});
    setErrors({});
    setStep(0);
    setFormError(null);
    setDone(false);
    if (!anonymous) {
      setName(prefill?.name ?? "");
      setEmail(prefill?.email ?? "");
    }
  }

  if (done) {
    return (
      <div className="py-10 text-center" data-testid="survey-thank-you">
        <p className="text-xl font-semibold text-[var(--acton-navy)]">
          Thanks! Your response was recorded.
        </p>
        {preview ? (
          <p className="mt-2 text-sm text-[var(--acton-muted)]">
            Preview only — nothing was saved.
          </p>
        ) : null}
        <Button type="button" variant="secondary" className="mt-6" onClick={startOver}>
          Submit another response
        </Button>
      </div>
    );
  }

  const identityBlock = anonymous ? (
    <p
      className="rounded-md bg-[var(--acton-gray-50)] px-3 py-2 text-sm text-[var(--acton-muted)]"
      data-testid="survey-anonymous-note"
    >
      This survey is anonymous. Your name and account are not recorded.
    </p>
  ) : (
    <div id={`survey-field-${IDENTITY_STEP}`} className="space-y-3">
      <div>
        <label
          htmlFor="survey-respondent-name"
          className="mb-1 block text-sm font-medium text-[var(--acton-navy)]"
        >
          Your name
          {survey.identityMode === "name_required" ? (
            <span className="ml-0.5 text-red-700" aria-hidden>
              *
            </span>
          ) : (
            <span className="ml-1 font-normal text-[var(--acton-muted)]">(optional)</span>
          )}
        </label>
        <Input
          id="survey-respondent-name"
          value={name}
          maxLength={200}
          autoComplete="name"
          required={survey.identityMode === "name_required"}
          aria-invalid={Boolean(errors[RESPONDENT_NAME_FIELD]) || undefined}
          onChange={(e) => setName(e.target.value)}
        />
        {errors[RESPONDENT_NAME_FIELD] ? (
          <p className="mt-1 text-sm text-red-700">{errors[RESPONDENT_NAME_FIELD]}</p>
        ) : null}
      </div>
      <div>
        <label
          htmlFor="survey-respondent-email"
          className="mb-1 block text-sm font-medium text-[var(--acton-navy)]"
        >
          Email <span className="font-normal text-[var(--acton-muted)]">(optional)</span>
        </label>
        <Input
          id="survey-respondent-email"
          type="email"
          value={email}
          maxLength={200}
          autoComplete="email"
          aria-invalid={Boolean(errors[RESPONDENT_EMAIL_FIELD]) || undefined}
          onChange={(e) => setEmail(e.target.value)}
        />
        {errors[RESPONDENT_EMAIL_FIELD] ? (
          <p className="mt-1 text-sm text-red-700">{errors[RESPONDENT_EMAIL_FIELD]}</p>
        ) : null}
      </div>
    </div>
  );

  const honeypot = (
    <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
      <label htmlFor="survey-website">Website</label>
      <input
        id="survey-website"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
      />
    </div>
  );

  const errorBanner = formError ? (
    <p className="text-sm text-red-700" role="alert">
      {formError}
    </p>
  ) : null;

  if (oneAtATime) {
    const current = steps[step];
    const question = survey.questions.find((q) => q.id === current);
    const isLast = step === steps.length - 1;
    const progress = Math.round(((step + 1) / steps.length) * 100);
    return (
      <form
        className="relative space-y-6"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (isLast) void submit();
          else next();
        }}
      >
        {honeypot}
        {anonymous && step === 0 ? identityBlock : null}
        <div>
          <div className="mb-1 flex justify-between text-xs text-[var(--acton-muted)]">
            <span>
              Step {step + 1} of {steps.length}
            </span>
            <span>{progress}%</span>
          </div>
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-[var(--acton-gray-50)]"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
            aria-label="Survey progress"
          >
            <div
              className="h-full rounded-full bg-[var(--acton-navy)] transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
        {current === IDENTITY_STEP ? (
          identityBlock
        ) : question ? (
          <QuestionField
            question={question}
            draft={drafts[question.id]}
            error={errors[question.id]}
            onChange={(d) => update(question.id, d)}
          />
        ) : null}
        {errorBanner}
        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="secondary"
            disabled={step === 0}
            onClick={() => {
              setErrors({});
              setStep((s) => Math.max(0, s - 1));
            }}
          >
            Back
          </Button>
          <Button type="submit" disabled={submitting}>
            {isLast ? (submitting ? "Submitting…" : "Submit") : "Next"}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form
      className="relative space-y-8"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {honeypot}
      {identityBlock}
      {survey.questions.map((q) => (
        <QuestionField
          key={q.id}
          question={q}
          draft={drafts[q.id]}
          error={errors[q.id]}
          onChange={(d) => update(q.id, d)}
        />
      ))}
      {errorBanner}
      <Button type="submit" className="w-full sm:w-auto" disabled={submitting}>
        {submitting ? "Submitting…" : "Submit"}
      </Button>
    </form>
  );
}

function QuestionField({
  question,
  draft,
  error,
  onChange,
}: {
  question: Question;
  draft: Draft | undefined;
  error: string | undefined;
  onChange: (draft: Draft) => void;
}) {
  const labelId = `survey-q-label-${question.id}`;
  const helpId = question.helpText ? `survey-q-help-${question.id}` : undefined;
  const inputId = `survey-q-input-${question.id}`;

  return (
    <fieldset id={`survey-field-${question.id}`} className="space-y-2" aria-describedby={helpId}>
      <legend id={labelId} className="text-base font-semibold text-[var(--acton-navy)]">
        {question.prompt}
        {question.required ? (
          <span className="ml-0.5 text-red-700" aria-label="required">
            *
          </span>
        ) : null}
      </legend>
      {question.helpText ? (
        <p id={helpId} className="text-sm text-[var(--acton-muted)]">
          {question.helpText}
        </p>
      ) : null}

      {question.type === "star_rating" ? (
        <StarRatingInput
          value={draft?.ratingValue ?? null}
          onChange={(v) => onChange({ ratingValue: v })}
          labelledBy={labelId}
          invalid={Boolean(error)}
        />
      ) : null}

      {question.type === "text" ? (
        <div>
          <textarea
            id={inputId}
            aria-labelledby={labelId}
            aria-invalid={Boolean(error) || undefined}
            value={draft?.textValue ?? ""}
            maxLength={SURVEY_TEXT_ANSWER_MAX}
            rows={3}
            onChange={(e) => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = `${Math.min(el.scrollHeight, 480)}px`;
              onChange({ textValue: e.target.value });
            }}
            className={cn(
              "w-full resize-none rounded-md border bg-white px-3 py-2 text-sm text-[var(--acton-navy)] focus-visible:ring-2 focus-visible:ring-[var(--acton-navy)] focus-visible:outline-none",
              error ? "border-red-600" : "border-[var(--acton-border)]",
            )}
          />
          {(draft?.textValue?.length ?? 0) > SURVEY_TEXT_ANSWER_MAX - 500 ? (
            <p className="text-right text-xs text-[var(--acton-muted)]">
              {draft?.textValue?.length ?? 0} / {SURVEY_TEXT_ANSWER_MAX}
            </p>
          ) : null}
        </div>
      ) : null}

      {question.type === "dropdown" ? (
        <select
          id={inputId}
          aria-labelledby={labelId}
          aria-invalid={Boolean(error) || undefined}
          value={draft?.optionIds?.[0] ?? ""}
          onChange={(e) => onChange({ optionIds: e.target.value ? [e.target.value] : [] })}
          className={cn(
            "h-11 w-full rounded-md border bg-white px-3 text-sm text-[var(--acton-navy)]",
            error ? "border-red-600" : "border-[var(--acton-border)]",
          )}
        >
          <option value="">Select…</option>
          {question.options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      ) : null}

      {question.type === "multi_select" ? (
        <div className="space-y-2">
          {question.options.map((o) => {
            const selected = draft?.optionIds ?? [];
            const checked = selected.includes(o.id);
            return (
              <label
                key={o.id}
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-[var(--acton-border)] px-3 text-sm text-[var(--acton-navy)] hover:bg-[var(--acton-gray-50)]"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={checked}
                  onChange={() =>
                    onChange({
                      optionIds: checked
                        ? selected.filter((id) => id !== o.id)
                        : [...selected, o.id],
                    })
                  }
                />
                {o.label}
              </label>
            );
          })}
        </div>
      ) : null}

      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </fieldset>
  );
}
