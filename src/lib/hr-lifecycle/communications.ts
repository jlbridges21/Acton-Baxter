/**
 * Default communication templates for the lifecycle checklist. They only ever become editable
 * drafts for HR review: nothing in the lifecycle module sends email or Slack messages.
 * Merge fields use the ops engine's {{field}} syntax; unknown fields stay visible.
 */

import { renderTemplate } from "@/lib/ops/definition";

export type CommunicationTemplate = {
  key: string;
  name: string;
  channel: "email" | "slack";
  subject: string;
  body: string;
  /** Where in the checklist it is used. */
  usedBy: string[];
};

export const DEFAULT_COMMUNICATIONS: CommunicationTemplate[] = [
  {
    key: "welcome_email",
    name: "Welcome email",
    channel: "email",
    subject: "Welcome to Acton ADU, {{first_name}}",
    body: "Hi {{first_name}},\n\nWe're glad you're joining Acton ADU. Here's what you need for Day 1 ({{start_date}}):\n\n- Time: {{day1_time}}\n- Location: {{work_location}}\n- Parking: {{parking}}\n- Dress code: {{dress_code}}\n- Schedule: {{day1_schedule}}\n\nYour manager is {{manager_name}}. Reply here with any questions.\n\n— Acton ADU",
    usedBy: ["pre-welcome-email"],
  },
  {
    key: "internal_announcement",
    name: "Internal announcement",
    channel: "slack",
    subject: "New team member",
    body: "Please welcome {{first_name}}, who joins the {{role_names}} team on {{start_date}}. {{manager_name}} is their manager.",
    usedBy: ["pre-calendar-announcement"],
  },
  {
    key: "baxter_intro",
    name: "Baxter intro sequence",
    channel: "slack",
    subject: "Meet Baxter",
    body: "Hi {{first_name}} — meet Baxter, Acton's AI assistant.\n\n- What Baxter is: {{baxter_summary}}\n- Staff-facing functions you can use: {{baxter_staff_functions}}\n- If Baxter misbehaves: {{baxter_support_contact}}\n\nA copy of this message is also sent by email so you can search for it later.",
    usedBy: ["on-baxter-intro"],
  },
  {
    key: "baxter_feedback",
    name: "Day 30 Baxter feedback prompt",
    channel: "slack",
    subject: "Quick question about Baxter",
    body: "Hi {{first_name}}, you've been with us about 30 days. What was confusing about Baxter so far? Your answer goes to {{tech_ops_manager_name}} to improve the playbook.",
    usedBy: ["on-baxter-feedback"],
  },
  {
    key: "onboarding_survey",
    name: "New hire onboarding survey invitation",
    channel: "email",
    subject: "How was your onboarding?",
    body: "Hi {{first_name}},\n\nYou've reached Day 90. Please take a few minutes to tell us how onboarding went: {{survey_link}}\n\nThank you.",
    usedBy: ["on-survey"],
  },
  {
    key: "departure_notice",
    name: "Need-to-know departure notice",
    channel: "email",
    subject: "Upcoming departure (need-to-know)",
    body: "This is a need-to-know notice for payroll, IT, and the direct team.\n\n{{first_name}}'s last day is {{last_day}}. Please plan handoffs with {{manager_name}}. Do not share this further.",
    usedBy: ["off-notify"],
  },
  {
    key: "exit_interview",
    name: "Exit interview invitation",
    channel: "email",
    subject: "Exit conversation",
    body: "Hi {{first_name}},\n\nBefore your last day ({{last_day}}), we'd like to schedule a short exit conversation. Does {{exit_interview_time}} work?\n\nThank you for your work at Acton ADU.",
    usedBy: ["off-exit-scheduled"],
  },
  {
    key: "auto_reply",
    name: "Email auto-reply after departure",
    channel: "email",
    subject: "Auto-reply",
    body: "Thank you for your message. {{first_name}} is no longer with Acton ADU. For help, please contact {{manager_name}} at {{manager_email}}.",
    usedBy: ["off-email-plan"],
  },
];

export function renderDraft(
  template: Pick<CommunicationTemplate, "subject" | "body">,
  values: Record<string, string | null | undefined>,
): { subject: string; body: string; missing: string[] } {
  const s = renderTemplate(template.subject, values);
  const b = renderTemplate(template.body, values);
  return { subject: s.text, body: b.text, missing: [...new Set([...s.missing, ...b.missing])] };
}
