/**
 * Report fields for the financial document, payment, and task sources. Every field is either
 * a JobTread value copied as-is (origin names the JobTread attribute) or derived by a stated
 * rule (origin starts with "Derived" or "Baxter"). Nothing is estimated.
 *
 * Fields whose JobTread attribute isn't available to this grant are hidden at catalog load
 * (see unavailableSourceFields), so reports never show a column that can't have values.
 */

import type { FieldDef, FieldType } from "./fields";
import type { ReportSource } from "./spec";

const make =
  (source: ReportSource) =>
  (
    key: string,
    label: string,
    type: FieldType,
    category: FieldDef["category"],
    origin: string,
    description?: string,
  ): FieldDef => ({
    key,
    label,
    type,
    category,
    source,
    origin,
    ...(description ? { description } : {}),
  });

const doc = make("documents");
const pay = make("payments");
const task = make("tasks");

/** One row per JobTread financial document (customer invoices, orders, vendor bills/orders). */
export const DOCUMENT_FIELDS: FieldDef[] = [
  doc("doc.number", "Document Number", "text", "general", "JobTread document.number"),
  doc("doc.name", "Document Name", "text", "general", "JobTread document.name"),
  doc("doc.id", "Document ID", "text", "general", "JobTread document.id", "Stable JobTread id."),
  doc(
    "doc.type",
    "Document Type",
    "text",
    "general",
    "JobTread document.type",
    "Customer invoice, customer order, vendor bill, vendor order.",
  ),
  doc("doc.rawStatus", "JobTread Status", "text", "general", "JobTread document.status (as-is)"),
  doc(
    "doc.lifecycle",
    "Lifecycle Status",
    "text",
    "general",
    "Baxter status mapping of JobTread type + status (Reports → Data settings → Financial data)",
    "Draft, Issued, Partially Paid, Paid, Voided, or Unknown (status not mapped yet). Separate from payment status.",
  ),
  doc(
    "doc.paymentStatus",
    "Payment Status",
    "text",
    "financial",
    "Derived from JobTread amountPaid and balance",
    "Unpaid, Partially paid, Paid, Overpaid, or Unknown. Independent of the lifecycle status.",
  ),
  doc(
    "doc.balanceVerification",
    "Balance Verification",
    "text",
    "financial",
    "Baxter reconciliation of JobTread amountPaid with synced payment records",
    "Verified, accepted JobTread balance (admin policy), mismatch, or unverified (payments not synced).",
  ),
  doc(
    "doc.jobId",
    "Job ID",
    "text",
    "general",
    "JobTread document.job.id",
    "Stable id of the document's job.",
  ),
  doc("doc.job", "Job", "text", "general", "JobTread job name (by document.job.id)"),
  doc("doc.jobNumber", "Job Number", "text", "general", "JobTread job number (by document.job.id)"),
  doc(
    "doc.customer",
    "Customer",
    "text",
    "general",
    "JobTread document account when available, else the job's customer account (by id)",
  ),
  doc(
    "doc.customerId",
    "Customer ID",
    "text",
    "general",
    "JobTread account id (document, else job location account)",
  ),
  doc("doc.issueDate", "Issue Date", "date", "general", "JobTread document.issueDate"),
  doc("doc.dueDate", "Due Date", "date", "general", "JobTread document.dueDate"),
  doc(
    "doc.daysPastDue",
    "Days Past Due",
    "number",
    "financial",
    "Derived: today − due date, for issued invoices with a balance",
    "Blank for drafts, voided, paid, or invoices without a due date.",
  ),
  doc(
    "doc.overdue",
    "Overdue",
    "boolean",
    "financial",
    "Derived: past due (plus grace days) with a verified unpaid balance",
    "Blank when the balance isn't verified — never assumed overdue or current.",
  ),
  doc("doc.amount", "Amount (before tax)", "currency", "financial", "JobTread document.price"),
  doc("doc.tax", "Tax", "currency", "financial", "JobTread document.tax"),
  doc(
    "doc.total",
    "Total",
    "currency",
    "financial",
    "Derived: JobTread price + tax",
    "Blank when either is blank.",
  ),
  doc("doc.cost", "Cost", "currency", "financial", "JobTread document.cost"),
  doc("doc.amountPaid", "Amount Paid", "currency", "financial", "JobTread document.amountPaid"),
  doc("doc.balance", "Balance", "currency", "financial", "JobTread document.balance"),
  doc(
    "doc.paymentsTotal",
    "Payments Recorded",
    "currency",
    "financial",
    "Sum of synced JobTread payments on this document (refunds subtract)",
    "Blank when payments aren't synced.",
  ),
  doc(
    "doc.paymentCount",
    "Payment Records",
    "number",
    "financial",
    "Count of synced JobTread payments on this document",
  ),
  doc(
    "doc.lastPaymentDate",
    "Last Payment Date",
    "date",
    "financial",
    "Latest synced JobTread payment date",
  ),
  doc(
    "doc.ppNumber",
    "PP#",
    "number",
    "general",
    "Approved PP# link, else the configured classification rule (Reports → Data settings → Financial data → PP# mapping)",
    "1–10. Check PP# Approval: a rule classification isn't a reviewed link. Blank until PP# mapping is configured.",
  ),
  doc(
    "doc.ppApproval",
    "PP# Approval",
    "text",
    "general",
    "Baxter PP# review status",
    "Approved, Approved — needs review (conflict), Pending approval, Auto-accepted, Rejected, Classified by rule (no link yet), Ambiguous, or Unclassified.",
  ),
  doc(
    "doc.ppVerified",
    "PP# Verified",
    "boolean",
    "general",
    "Derived: an administrator approved the link and it has no conflict",
  ),
  doc(
    "doc.milestonePct",
    "Milestone %",
    "percent",
    "financial",
    "Baxter PP# percentage split (standard PP#1–10, or a labelled project override)",
    "Configured share of the contract for this PP#. Never changes the invoice amount and says nothing about payment.",
  ),
  doc(
    "doc.milestonePctSource",
    "Milestone % Source",
    "text",
    "general",
    "standard, project override, or approved link",
  ),
  doc(
    "doc.milestoneTaskId",
    "Milestone Task ID",
    "text",
    "general",
    "PP# link to a JobTread task (stable id), same project only",
    "Only approved links (or unique matches when an admin allows auto-accept).",
  ),
  doc("doc.milestone", "Milestone", "text", "general", "JobTread task name of the PP# link"),
  doc(
    "doc.milestoneStart",
    "Milestone Scheduled Start",
    "date",
    "general",
    "JobTread task.startDate of the PP# link",
  ),
  doc(
    "doc.milestoneEnd",
    "Milestone Scheduled End",
    "date",
    "general",
    "JobTread task.endDate of the PP# link",
  ),
  doc(
    "doc.milestoneComplete",
    "Milestone Complete",
    "boolean",
    "general",
    "JobTread task.completed of the PP# link",
    "JobTread doesn't give Baxter an actual completion date, only whether the task is complete.",
  ),
  doc(
    "doc.ppLinkStatus",
    "PP# Link Status",
    "text",
    "general",
    "Baxter PP# link: approved, suggested, rejected, or none",
  ),
  doc(
    "doc.statusConflict",
    "Status Conflict",
    "text",
    "financial",
    "Derived: lifecycle status disagrees with JobTread amounts",
  ),
  doc("doc.createdAt", "Created", "date", "general", "JobTread document.createdAt"),
  doc("doc.updatedAt", "Updated", "date", "general", "JobTread document.updatedAt"),
  doc("doc.signedAt", "Signed", "date", "general", "JobTread document.signedAt"),
  doc(
    "doc.syncedAt",
    "Last Synced",
    "date",
    "general",
    "When Baxter last read this document from JobTread",
  ),
  doc(
    "doc.sourceRef",
    "Source Reference",
    "text",
    "general",
    "JobTread document id (for tracing a number back to JobTread)",
  ),
];

/** One row per JobTread payment record (refunds and reversals are their own rows). */
export const PAYMENT_FIELDS: FieldDef[] = [
  pay("pay.id", "Payment ID", "text", "financial", "JobTread payment.id"),
  pay("pay.amount", "Amount", "currency", "financial", "JobTread payment.amount (as-is)"),
  pay(
    "pay.signedAmount",
    "Net Amount",
    "currency",
    "financial",
    "Derived: payment amount, with refunds and reversals negative",
    "Sum this for cash collected — refunds reduce it, nothing is counted twice.",
  ),
  pay(
    "pay.kind",
    "Kind",
    "text",
    "financial",
    "Derived: payment, refund, or reversal (negative amount or JobTread type)",
  ),
  pay(
    "pay.type",
    "JobTread Payment Type",
    "text",
    "financial",
    "JobTread payment type (when this grant exposes it)",
  ),
  pay("pay.date", "Payment Date", "date", "financial", "JobTread payment.date"),
  pay("pay.documentId", "Document ID", "text", "financial", "JobTread payment.document.id"),
  pay(
    "pay.documentNumber",
    "Invoice Number",
    "text",
    "financial",
    "JobTread document number (by payment.document.id)",
  ),
  pay("pay.jobId", "Job ID", "text", "general", "JobTread payment.job.id, else the document's job"),
  pay("pay.job", "Job", "text", "general", "JobTread job name (by job id)"),
  pay(
    "pay.possibleDuplicate",
    "Possible Duplicate",
    "boolean",
    "financial",
    "Derived: another payment has the same document, amount, and date",
    "Flagged for review only; both rows are kept (JobTread ids differ).",
  ),
  pay("pay.createdAt", "Created", "date", "financial", "JobTread payment.createdAt"),
  pay(
    "pay.syncedAt",
    "Last Synced",
    "date",
    "general",
    "When Baxter last read this payment from JobTread",
  ),
];

/** One row per JobTread task (schedule tasks, milestone groups, to-dos). */
export const TASK_FIELDS: FieldDef[] = [
  task("task.name", "Task", "text", "general", "JobTread task.name"),
  task("task.id", "Task ID", "text", "general", "JobTread task.id"),
  task(
    "task.jobId",
    "Job ID",
    "text",
    "general",
    "JobTread task.job.id",
    "Stable id of the task's job.",
  ),
  task("task.job", "Job", "text", "general", "JobTread job name (by task.job.id)"),
  task("task.jobNumber", "Job Number", "text", "general", "JobTread job number (by task.job.id)"),
  task("task.startDate", "Start Date", "date", "general", "JobTread task.startDate"),
  task("task.endDate", "End Date", "date", "general", "JobTread task.endDate"),
  task(
    "task.progress",
    "Progress",
    "percent",
    "general",
    "JobTread task.progress (0–1, shown as 0–100%)",
  ),
  task("task.complete", "Complete", "boolean", "general", "Derived: JobTread task.completed ≥ 1"),
  task(
    "task.scheduleStatus",
    "Schedule Status",
    "text",
    "general",
    "Derived from JobTread end date and completion",
    "Complete, Late (past end date, not complete), In progress, Not started, or No dates.",
  ),
  task("task.isMilestoneGroup", "Milestone Group", "boolean", "general", "JobTread task.isGroup"),
  task("task.isToDo", "To-Do", "boolean", "general", "JobTread task.isToDo"),
  task(
    "task.parentId",
    "Parent Task ID",
    "text",
    "general",
    "JobTread task.parentTask.id (when this grant exposes it)",
  ),
  task("task.createdAt", "Created", "date", "general", "JobTread task.createdAt"),
  task(
    "task.syncedAt",
    "Last Synced",
    "date",
    "general",
    "When Baxter last read this task from JobTread",
  ),
];

/**
 * Field keys backed by a JobTread attribute the grant doesn't return (recorded as dropped by
 * the sync). Derived fields stay; their inputs are explained by their own blanks.
 */
export const FIELD_SYNC_ATTRIBUTE: Record<
  string,
  { entity: "documents" | "payments" | "tasks"; attribute: string }
> = {
  "doc.updatedAt": { entity: "documents", attribute: "updatedAt" },
  "doc.signedAt": { entity: "documents", attribute: "signedAt" },
  "doc.tax": { entity: "documents", attribute: "tax" },
  "doc.amountPaid": { entity: "documents", attribute: "amountPaid" },
  "doc.balance": { entity: "documents", attribute: "balance" },
  "doc.dueDate": { entity: "documents", attribute: "dueDate" },
  "pay.type": { entity: "payments", attribute: "type" },
  "pay.date": { entity: "payments", attribute: "date" },
  "task.parentId": { entity: "tasks", attribute: "parentTask" },
  "task.progress": { entity: "tasks", attribute: "progress" },
};
