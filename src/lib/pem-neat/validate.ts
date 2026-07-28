import { validateFollowUpEmailCustomerSafe, type PemNeatStructuredResult } from "./schemas";

/**
 * Deterministic post-generation safeguards.
 * Prefix "HARD:" for failures that must reject the result.
 */
export function runDeterministicNeatChecks(
  result: PemNeatStructuredResult,
  transcript: string,
): string[] {
  const issues: string[] = [];
  const lowerTranscript = transcript.toLowerCase();

  for (const msg of validateFollowUpEmailCustomerSafe(result.followUpEmail.body)) {
    issues.push(msg);
  }

  // Exact quotes in coaching/evidence longer than 40 chars should appear in transcript
  const quotePattern = /"([^"]{40,})"/g;
  const bodies = [
    result.assessment.oneThing,
    ...result.assessment.categories.map((c) => c.evidence ?? ""),
    ...result.assessment.categories.map((c) => c.coachingOpportunity ?? ""),
  ];
  for (const body of bodies) {
    let match: RegExpExecArray | null;
    const re = new RegExp(quotePattern);
    while ((match = re.exec(body))) {
      const quote = match[1] ?? "";
      if (quote && !lowerTranscript.includes(quote.toLowerCase())) {
        issues.push("Quoted evidence not found in transcript");
      }
    }
  }

  // Dollar amounts in stated budget should appear somewhere if numeric claim is specific
  const stated = result.salesIntelligence.budget.statedBudget?.value;
  if (stated) {
    const digits = stated.replace(/[^\d]/g, "");
    if (digits.length >= 5) {
      const compactTx = transcript.replace(/[^\d]/g, "");
      if (!compactTx.includes(digits) && !transcript.includes(stated)) {
        // Soft: may be formatted differently
        issues.push("Stated budget digits not clearly grounded in transcript");
      }
    }
  }

  // Incomplete transcript + MISSED scores → soft warning
  if (!result.analysisMetadata.transcriptComplete) {
    const unfairMissed = result.assessment.categories.filter((c) => c.status === "MISSED");
    if (unfairMissed.length >= 4) {
      issues.push(
        "Many MISSED scores on incomplete transcript — prefer NOT_DETERMINABLE when evidence is absent due to incompleteness",
      );
    }
  }

  // BuilderTrend must not contain coaching language
  const btBlob = JSON.stringify(result.buildertrendFields).toLowerCase();
  if (/\b(coaching|score\s*\/\s*10|type\s*1\s*pain|qualification)\b/.test(btBlob)) {
    issues.push("BuilderTrend fields appear to contain internal sales coaching language");
  }

  return [...new Set(issues)];
}
