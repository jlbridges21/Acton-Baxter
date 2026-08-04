import type { CustomerDossier } from "./types";

/**
 * Chat/Slack-friendly dossier summary. Read-only — never suggests starting Project Setup.
 */
export function formatDossierChatSummary(dossier: CustomerDossier): string {
  const name = dossier.identity.displayName ?? "this customer";
  const lines: string[] = [`Here’s what Baxter can see about ${name}:`, ""];

  // GHL
  lines.push("GoHighLevel");
  if (dossier.ghl.status === "error") {
    lines.push(`• Unavailable: ${dossier.ghl.error ?? "error loading CRM data"}`);
  } else if (dossier.ghl.status === "empty" || !dossier.ghl.contactId) {
    lines.push(
      dossier.ghl.clarificationMessage
        ? `• ${dossier.ghl.clarificationMessage}`
        : "• No matching GHL contact found.",
    );
  } else {
    lines.push(`• Contact: ${dossier.ghl.contactName ?? name}`);
    if (dossier.ghl.email) lines.push(`• Email: ${dossier.ghl.email}`);
    if (dossier.ghl.phone) lines.push(`• Phone: ${dossier.ghl.phone}`);
    if (dossier.ghl.address) lines.push(`• Address: ${dossier.ghl.address}`);
    if (dossier.ghl.city) lines.push(`• City: ${dossier.ghl.city}`);
    if (dossier.ghl.state) lines.push(`• State: ${dossier.ghl.state}`);
    if (dossier.ghl.postalCode) lines.push(`• Postal code: ${dossier.ghl.postalCode}`);
    if (dossier.ghl.projectTypeConsidering) {
      lines.push(`• Project type considering: ${dossier.ghl.projectTypeConsidering}`);
    }
    if (dossier.ghl.opportunities.length === 0) {
      lines.push("• Opportunities: none on file");
    } else {
      for (const opp of dossier.ghl.opportunities.slice(0, 3)) {
        const stage = opp.stageName ?? opp.status ?? "unknown stage";
        lines.push(`• Opportunity: ${opp.name ?? "Untitled"} — ${stage}`);
      }
    }
  }
  lines.push("");

  // PEM
  lines.push("PEM NEAT");
  if (dossier.pemNeats.status === "error") {
    lines.push(`• Unavailable: ${dossier.pemNeats.error ?? "error loading PEM records"}`);
  } else if (dossier.pemNeats.status === "unavailable") {
    lines.push(`• ${dossier.pemNeats.error ?? "Not available"}`);
  } else if (dossier.pemNeats.records.length === 0) {
    lines.push("• No linked PEM NEAT found.");
  } else {
    for (const pem of dossier.pemNeats.records.slice(0, 3)) {
      const outcome = pem.meetingOutcome ?? "outcome n/a";
      const qual = pem.qualification ?? "qualification n/a";
      lines.push(`• ${pem.prospectName}: ${outcome}, ${qual} (${pem.status}) — ${pem.href}`);
    }
  }
  lines.push("");

  // Project Setup — factual only
  lines.push("Project Setup");
  if (dossier.projectSetup.status === "error") {
    lines.push(
      `• Unavailable: ${dossier.projectSetup.error ?? "error loading project setup runs"}`,
    );
  } else if (dossier.projectSetup.runs.length === 0) {
    lines.push(`• ${dossier.projectSetup.emptyMessage ?? "No Project Setup run found."}`);
  } else {
    for (const run of dossier.projectSetup.runs.slice(0, 3)) {
      const bits = [
        run.projectNumber ?? "no project number",
        run.status,
        run.dryRun ? "dry-run" : null,
      ].filter(Boolean);
      lines.push(`• ${bits.join(" · ")} — ${run.href}`);
      if (run.folderLink) lines.push(`  Folder: ${run.folderLink}`);
      if (run.charterLink) lines.push(`  Charter: ${run.charterLink}`);
      if (run.slackChannelName) lines.push(`  Slack: #${run.slackChannelName}`);
    }
  }

  // Monitoring — only when not omitted
  if (dossier.monitoring.status !== "omitted") {
    lines.push("");
    lines.push("Process Monitoring");
    if (dossier.monitoring.status === "error") {
      lines.push(`• Unavailable: ${dossier.monitoring.error ?? "error loading findings"}`);
    } else if (dossier.monitoring.findings.length === 0) {
      lines.push("• No open findings.");
    } else {
      for (const f of dossier.monitoring.findings.slice(0, 5)) {
        lines.push(`• [${f.severity}] ${f.title} (${f.status})`);
      }
      lines.push(
        `• Full list: ${dossier.monitoring.findings[0]?.href ?? "/admin/baxter/monitoring"}`,
      );
    }
  }

  lines.push("");
  lines.push(`Customer Center: ${dossier.pagePath}`);
  return lines.join("\n");
}

/** True when the question is a broad "tell me everything" ask — not a narrow single-fact CRM/PEM question. */
export function isBroadDossierQuestion(question: string): boolean {
  const q = question.trim();
  if (!q) return false;

  // Explicit narrow asks that existing sources own — never claim these.
  if (
    /\b(stage|pipeline|email|phone|address|owner|tag|budget|type\s*[12]|pain|qualification|coaching|raci|responsible|who (?:is|owns))\b/i.test(
      q,
    ) &&
    !/\b(tell me everything|everything about|full (?:picture|profile|dossier|overview)|customer (?:dossier|center)|what do we know about)\b/i.test(
      q,
    )
  ) {
    return false;
  }

  // PEM-specific "everything about X's PEM" stays with PEM source.
  if (
    /\b(pem|neat)\b/i.test(q) &&
    !/\b(dossier|customer center|full picture|across systems|ghl and)\b/i.test(q)
  ) {
    return false;
  }

  return /\b(tell me everything|everything about|full (?:picture|profile|dossier|overview)|customer (?:dossier|center|overview|summary)|what do we know about|pull up everything|dossier (?:for|on))\b/i.test(
    q,
  );
}
