import { z } from "zod";
import { isActonEmail, normalizeEmailList } from "./names";
import { parseProjectNumber } from "./project-number";

export const projectSetupSettingsPatchSchema = z.object({
  memberEmails: z.array(z.string()).optional(),
  testMode: z.boolean().optional(),
  testMemberEmails: z.array(z.string()).optional(),
  templateFolderId: z.string().min(1).optional(),
  projectsParentFolderId: z.string().min(1).optional(),
  masterCharterSpreadsheetId: z.string().min(1).optional(),
  masterLogTabName: z.string().min(1).optional(),
});

export type ProjectSetupSettingsWarnings = {
  nonActonMemberEmails: string[];
  nonActonTestMemberEmails: string[];
};

export function validateSettingsEmails(input: {
  memberEmails?: string[];
  testMemberEmails?: string[];
}): ProjectSetupSettingsWarnings {
  const members = normalizeEmailList(input.memberEmails ?? []);
  const testMembers = normalizeEmailList(input.testMemberEmails ?? []);
  return {
    nonActonMemberEmails: members.filter((e) => !isActonEmail(e)),
    nonActonTestMemberEmails: testMembers.filter((e) => !isActonEmail(e)),
  };
}

export const createProjectSetupRunSchema = z.object({
  ghlContactId: z.string().min(1),
  salesRep: z.string().min(1, "Sales rep is required"),
  projectNumber: z
    .string()
    .min(1)
    .transform((v) => v.trim().toUpperCase())
    .refine((v) => Boolean(parseProjectNumber(v)), {
      message: "Project number must look like L01-26017",
    }),
  projectLastName: z.string().min(1),
  fpPaidDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "FP paid date must be YYYY-MM-DD"),
  contactSnapshot: z
    .object({
      id: z.string(),
      name: z.string().nullable().optional(),
      firstName: z.string().nullable().optional(),
      lastName: z.string().nullable().optional(),
      email: z.string().nullable().optional(),
      phone: z.string().nullable().optional(),
      address: z.string().nullable().optional(),
      city: z.string().nullable().optional(),
      state: z.string().nullable().optional(),
      postalCode: z.string().nullable().optional(),
      assignedUserId: z.string().nullable().optional(),
      assignedUserName: z.string().nullable().optional(),
    })
    .optional(),
});
