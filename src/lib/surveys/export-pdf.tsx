/**
 * Survey results PDF (server-side via @react-pdf/renderer), styled like the
 * site-inspection report. Respondent names are omitted for anonymous surveys.
 */

import "server-only";

import React from "react";
import { Document, Image, Page, StyleSheet, Text, View, pdf } from "@react-pdf/renderer";
import { getBrandingWithLogo } from "@/lib/branding/get-branding";
import { loadLogoDataUri } from "@/lib/inspections/ai/export-pdf";
import { buildSurveyAnalytics, type QuestionSummary, type SurveyAnalytics } from "./analytics";
import { SURVEY_QUESTION_TYPE_LABELS, type SurveyDetail, type SurveyResponse } from "./types";

const colors = {
  navy: "#0B1F3A",
  muted: "#5A6A7A",
  border: "#D8DEE6",
  yellow: "#F5C518",
  paper: "#FFFFFF",
  soft: "#F5F7FA",
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 48,
    paddingBottom: 72,
    paddingHorizontal: 44,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: colors.navy,
    backgroundColor: colors.paper,
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 24 },
  brandMark: { width: 36, height: 36, objectFit: "contain" },
  brandName: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  accent: { height: 4, width: 72, backgroundColor: colors.yellow, marginBottom: 14 },
  title: { fontSize: 22, fontFamily: "Helvetica-Bold", marginBottom: 6, lineHeight: 1.25 },
  description: { fontSize: 11, color: colors.muted, marginBottom: 14, lineHeight: 1.4 },
  metaRow: { flexDirection: "row", gap: 18, marginBottom: 20 },
  metaLabel: {
    fontSize: 8,
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  metaValue: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 2 },
  sectionTitle: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    marginTop: 10,
    marginBottom: 10,
    paddingBottom: 5,
    borderBottomWidth: 1.5,
    borderBottomColor: colors.yellow,
  },
  // Spacing sits above each block: trailing bottom margin on the last block spills onto an empty page.
  question: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 0.5,
    borderTopColor: colors.border,
  },
  firstQuestion: { marginTop: 0, paddingTop: 0, borderTopWidth: 0 },
  prompt: { fontSize: 11, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  questionMeta: {
    fontSize: 8,
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 8,
  },
  barRow: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
  barLabel: { width: "32%", fontSize: 9, paddingRight: 6 },
  barTrack: { width: "50%", height: 8, backgroundColor: colors.soft, borderRadius: 2 },
  barFill: { height: 8, backgroundColor: colors.navy, borderRadius: 2 },
  barValue: { width: "18%", fontSize: 9, textAlign: "right", color: colors.muted },
  average: { fontSize: 18, fontFamily: "Helvetica-Bold", marginBottom: 6 },
  textAnswer: {
    marginBottom: 6,
    padding: 6,
    backgroundColor: colors.soft,
    borderRadius: 2,
  },
  textBody: { fontSize: 9.5, lineHeight: 1.4 },
  textMeta: { fontSize: 8, color: colors.muted, marginTop: 3 },
  note: { fontSize: 8, color: colors.muted, marginTop: 4 },
  muted: { fontSize: 9.5, color: colors.muted },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 44,
    right: 44,
    height: 28,
    flexDirection: "row",
    alignItems: "center",
    fontSize: 8,
    color: colors.muted,
  },
  footerLeft: { width: "28%", textAlign: "left" },
  footerCenter: { width: "44%", textAlign: "center" },
  footerRight: { width: "28%", textAlign: "right" },
});

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function Bar({ label, count, pct }: { label: string; count: number; pct: number }) {
  return (
    <View style={styles.barRow} wrap={false}>
      <Text style={styles.barLabel}>{label}</Text>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${Math.min(100, Math.max(0, pct))}%` }]} />
      </View>
      <Text style={styles.barValue}>
        {count} · {pct}%
      </Text>
    </View>
  );
}

function QuestionBlock({ summary, first }: { summary: QuestionSummary; first: boolean }) {
  const q = summary.question;
  return (
    <View style={first ? [styles.question, styles.firstQuestion] : styles.question}>
      <Text style={styles.prompt}>{q.prompt}</Text>
      <Text style={styles.questionMeta}>
        {SURVEY_QUESTION_TYPE_LABELS[q.type]} · {summary.answeredCount} answered
      </Text>
      {summary.kind === "star_rating" ? (
        <View>
          <Text style={styles.average}>
            {summary.average === null ? "No ratings yet" : `${summary.average.toFixed(2)} / 5`}
          </Text>
          {[...summary.distribution].reverse().map((d) => (
            <Bar
              key={d.value}
              label={`${d.value} star${d.value === 1 ? "" : "s"}`}
              count={d.count}
              pct={d.percent}
            />
          ))}
        </View>
      ) : null}
      {summary.kind === "text" ? (
        summary.answers.length === 0 ? (
          <Text style={styles.muted}>No answers yet.</Text>
        ) : (
          summary.answers.map((a) => (
            <View key={a.responseId} style={styles.textAnswer} wrap={false}>
              <Text style={styles.textBody}>{a.text}</Text>
              <Text style={styles.textMeta}>
                {a.respondent ? `${a.respondent} · ` : ""}
                {formatDate(a.submittedAt)}
              </Text>
            </View>
          ))
        )
      ) : null}
      {summary.kind === "dropdown" ? (
        <View>
          {summary.options.map((o) => (
            <Bar key={o.id} label={o.label} count={o.count} pct={o.percent} />
          ))}
          {summary.noAnswer ? (
            <Bar label="No answer" count={summary.noAnswer.count} pct={summary.noAnswer.percent} />
          ) : null}
        </View>
      ) : null}
      {summary.kind === "multi_select" ? (
        <View>
          {summary.options.map((o) => (
            <Bar key={o.id} label={o.label} count={o.count} pct={o.percent} />
          ))}
          <Text style={styles.note}>
            Percent of people who answered this question. Totals can exceed 100% because people can
            pick more than one.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export function SurveyPdfDocument({
  survey,
  analytics,
  companyName,
  logoDataUri,
  generatedAt,
}: {
  survey: Pick<SurveyDetail, "title" | "description" | "identityMode">;
  analytics: SurveyAnalytics;
  companyName: string;
  logoDataUri: string | null;
  generatedAt: string;
}) {
  return (
    <Document title={`${survey.title} — Survey results`} author={companyName}>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.brandRow}>
          {logoDataUri ? (
            // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt prop
            <Image src={logoDataUri} style={styles.brandMark} />
          ) : null}
          <Text style={styles.brandName}>{companyName}</Text>
        </View>
        <View style={styles.accent} />
        <Text style={styles.title}>{survey.title}</Text>
        {survey.description ? <Text style={styles.description}>{survey.description}</Text> : null}
        <View style={styles.metaRow}>
          <View>
            <Text style={styles.metaLabel}>Responses</Text>
            <Text style={styles.metaValue}>{analytics.totalResponses}</Text>
          </View>
          <View>
            <Text style={styles.metaLabel}>Generated</Text>
            <Text style={styles.metaValue}>{formatDate(generatedAt)}</Text>
          </View>
          {survey.identityMode === "anonymous" ? (
            <View>
              <Text style={styles.metaLabel}>Responses are</Text>
              <Text style={styles.metaValue}>Anonymous</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.sectionTitle}>Results</Text>
        {analytics.questions.length === 0 ? (
          <Text style={styles.muted}>This survey has no questions.</Text>
        ) : (
          analytics.questions.map((s, i) => (
            <QuestionBlock key={s.question.id} summary={s} first={i === 0} />
          ))
        )}

        {analytics.removedQuestions.length > 0 ? (
          <View>
            <Text style={styles.sectionTitle}>Removed questions</Text>
            {analytics.removedQuestions.map((s, i) => (
              <QuestionBlock key={s.question.id} summary={s} first={i === 0} />
            ))}
          </View>
        ) : null}

        <View style={styles.footer} fixed>
          <Text style={styles.footerLeft}>{companyName}</Text>
          <Text style={styles.footerCenter}>
            {survey.title.length > 36 ? `${survey.title.slice(0, 34)}…` : survey.title} — Survey
          </Text>
          <Text
            style={styles.footerRight}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}

export async function buildSurveyPdf(
  survey: SurveyDetail,
  responses: SurveyResponse[],
): Promise<Buffer> {
  const [branding, logoDataUri] = await Promise.all([getBrandingWithLogo(), loadLogoDataUri()]);
  const analytics = buildSurveyAnalytics(survey, responses);
  const instance = pdf(
    <SurveyPdfDocument
      survey={survey}
      analytics={analytics}
      companyName={branding.companyName || "Acton ADU"}
      logoDataUri={logoDataUri}
      generatedAt={new Date().toISOString()}
    />,
  );
  const blob = await instance.toBlob();
  return Buffer.from(await blob.arrayBuffer());
}
