import { z } from "zod";

function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

const nonEmptyText = (max: number) => z.string().trim().min(1).max(max);

export const aiFindingSchema = z.object({
  title: nonEmptyText(120),
  description: nonEmptyText(600),
  sourceFieldKeys: z.array(z.string().trim().min(1).max(80)).min(1).max(8),
});

export const aiReportContentSchema = z.object({
  researchSummary: z
    .string()
    .trim()
    .min(1)
    .max(2500)
    .refine(
      (value) => {
        const words = wordCount(value);
        return words >= 80 && words <= 180;
      },
      {
        message: "Research summary must be between 80 and 180 words",
      },
    ),
  importantPropertyFindings: z.array(aiFindingSchema).min(1).max(3),
  propertySpecificQuestions: z.array(nonEmptyText(400)).min(1).max(5),
  verifyDuringPem: z.array(nonEmptyText(400)).min(1).max(4),
  verifyDuringFeasibility: z.array(nonEmptyText(400)).min(1).max(4),
  verifyThroughTitleOrSurvey: z.array(nonEmptyText(400)).min(1).max(3),
  verifyWithPlanning: z.array(nonEmptyText(400)).min(1).max(4),
});

export type AiReportContent = z.infer<typeof aiReportContentSchema>;
export type AiFinding = z.infer<typeof aiFindingSchema>;

export function countWords(value: string): number {
  return wordCount(value);
}
