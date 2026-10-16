"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { nanoid } from "nanoid";
import { ArrowDown, ArrowUp, Copy, GripVertical, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  SURVEY_QUESTION_TYPES,
  SURVEY_QUESTION_TYPE_LABELS,
  questionTypeHasOptions,
  type SurveyOption,
  type SurveyQuestionType,
} from "@/lib/surveys/types";
import { cn } from "@/lib/utils";

export type DraftQuestion = {
  id: string;
  prompt: string;
  helpText: string;
  type: SurveyQuestionType;
  required: boolean;
  options: SurveyOption[];
};

export function newOptionId() {
  return nanoid(10);
}

const YES_NO_NA = ["Yes", "No", "N/A"];

export function SurveyQuestionCard({
  question,
  index,
  hasAnswers,
  onChange,
  onDuplicate,
  onDelete,
}: {
  question: DraftQuestion;
  index: number;
  hasAnswers: boolean;
  onChange: (next: DraftQuestion) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: question.id });
  const promptId = `q-prompt-${question.id}`;
  const helpId = `q-help-${question.id}`;
  const typeId = `q-type-${question.id}`;

  function setType(type: SurveyQuestionType) {
    let options = question.options;
    if (questionTypeHasOptions(type) && options.length === 0) {
      options = [
        { id: newOptionId(), label: "Option 1" },
        { id: newOptionId(), label: "Option 2" },
      ];
    }
    onChange({ ...question, type, options });
  }

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "rounded-lg border border-[var(--acton-border)] bg-white p-4 shadow-sm",
        isDragging && "relative z-10 opacity-80 shadow-lg",
      )}
      data-testid="survey-question-card"
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          ref={setActivatorNodeRef}
          className="mt-2 cursor-grab touch-none rounded p-1 text-[var(--acton-muted)] hover:bg-[var(--acton-gray-50)] active:cursor-grabbing"
          aria-label={`Reorder question ${index + 1}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <label
              htmlFor={promptId}
              className="mb-1 block text-xs font-semibold text-[var(--acton-muted)] uppercase"
            >
              Question {index + 1}
            </label>
            <Input
              id={promptId}
              value={question.prompt}
              maxLength={500}
              placeholder="What would you like to ask?"
              onChange={(e) => onChange({ ...question, prompt: e.target.value })}
            />
          </div>
          <div>
            <label
              htmlFor={helpId}
              className="mb-1 block text-xs font-semibold text-[var(--acton-muted)] uppercase"
            >
              Help text (optional)
            </label>
            <Input
              id={helpId}
              value={question.helpText}
              maxLength={1000}
              placeholder="Extra context shown under the question"
              onChange={(e) => onChange({ ...question, helpText: e.target.value })}
            />
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <div className="min-w-[220px]">
              <label
                htmlFor={typeId}
                className="mb-1 block text-xs font-semibold text-[var(--acton-muted)] uppercase"
              >
                Type
              </label>
              <select
                id={typeId}
                value={question.type}
                disabled={hasAnswers}
                title={
                  hasAnswers ? "This question has responses, so its type is locked." : undefined
                }
                onChange={(e) => setType(e.target.value as SurveyQuestionType)}
                className="h-11 w-full rounded-md border border-[var(--acton-border)] bg-white px-3 text-sm text-[var(--acton-navy)] disabled:bg-[var(--acton-gray-50)]"
              >
                {SURVEY_QUESTION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {SURVEY_QUESTION_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex h-11 items-center gap-2 text-sm text-[var(--acton-navy)]">
              <input
                type="checkbox"
                role="switch"
                aria-checked={question.required}
                checked={question.required}
                onChange={(e) => onChange({ ...question, required: e.target.checked })}
                className="h-4 w-4"
              />
              Required
            </label>
          </div>
          {hasAnswers ? (
            <p className="text-xs text-[var(--acton-muted)]">
              This question has responses, so its type is locked.
            </p>
          ) : null}
          {questionTypeHasOptions(question.type) ? (
            <OptionsEditor
              question={question}
              hasAnswers={hasAnswers}
              onChange={(options) => onChange({ ...question, options })}
            />
          ) : null}
        </div>
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={onDuplicate}
            aria-label={`Duplicate question ${index + 1}`}
            className="rounded p-2 text-[var(--acton-navy)] hover:bg-[var(--acton-gray-50)]"
          >
            <Copy className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete question ${index + 1}`}
            className="rounded p-2 text-red-700 hover:bg-red-50"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </li>
  );
}

function OptionsEditor({
  question,
  hasAnswers,
  onChange,
}: {
  question: DraftQuestion;
  hasAnswers: boolean;
  onChange: (options: SurveyOption[]) => void;
}) {
  const options = question.options;

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= options.length) return;
    const next = [...options];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  }

  function quickFill() {
    const byLabel = new Map(options.map((o) => [o.label.trim().toLowerCase(), o]));
    onChange(
      YES_NO_NA.map((label) => byLabel.get(label.toLowerCase()) ?? { id: newOptionId(), label }),
    );
  }

  return (
    <div className="rounded-md bg-[var(--acton-gray-50)] p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-[var(--acton-muted)] uppercase">Options</p>
        {question.type === "dropdown" ? (
          <Button type="button" variant="ghost" size="sm" onClick={quickFill}>
            Use Yes / No / N/A
          </Button>
        ) : null}
      </div>
      <ul className="space-y-2">
        {options.map((option, i) => (
          <li key={option.id} className="flex items-center gap-1">
            <Input
              aria-label={`Option ${i + 1}`}
              value={option.label}
              maxLength={200}
              onChange={(e) =>
                onChange(
                  options.map((o) => (o.id === option.id ? { ...o, label: e.target.value } : o)),
                )
              }
              className="h-9"
            />
            <button
              type="button"
              aria-label={`Move option ${i + 1} up`}
              disabled={i === 0}
              onClick={() => move(i, -1)}
              className="rounded p-1.5 text-[var(--acton-navy)] hover:bg-white disabled:opacity-30"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label={`Move option ${i + 1} down`}
              disabled={i === options.length - 1}
              onClick={() => move(i, 1)}
              className="rounded p-1.5 text-[var(--acton-navy)] hover:bg-white disabled:opacity-30"
            >
              <ArrowDown className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label={`Remove option ${i + 1}`}
              onClick={() => onChange(options.filter((o) => o.id !== option.id))}
              className="rounded p-1.5 text-red-700 hover:bg-white"
            >
              <X className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="mt-2"
        onClick={() => onChange([...options, { id: newOptionId(), label: "" }])}
      >
        <Plus className="mr-1 h-4 w-4" /> Add option
      </Button>
      {hasAnswers ? (
        <p className="mt-1 text-xs text-[var(--acton-muted)]">
          Renaming keeps past answers. Removing an option hides its past answers from results.
        </p>
      ) : null}
    </div>
  );
}
