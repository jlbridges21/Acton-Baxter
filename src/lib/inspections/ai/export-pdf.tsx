/**
 * Build a site-inspection PDF report (server-side via @react-pdf/renderer).
 * Images are resized with sharp before embedding to keep email-sized output.
 * Internal guide notes are intentionally omitted — they are inspector instructions, not findings.
 */

import "server-only";

import React from "react";
import { Document, Page, Text, View, Image, StyleSheet, pdf, Font } from "@react-pdf/renderer";
import { getBrandingWithLogo } from "@/lib/branding/get-branding";
import { createServiceClient } from "@/lib/supabase/admin";
import { BRANDING_ASSETS_BUCKET } from "@/lib/branding/types";
import type { SiteInspectionDetail } from "../record-types";
import type { SnapshotItem, SnapshotSection } from "../snapshot";
import { downloadSiteInspectionMediaBytes, uploadSiteInspectionMediaBytes } from "../media-storage";
import { posterStoragePathForVideo } from "../video-remux";
import { getEnv } from "@/lib/env";

/** Max photos+video posters to generate inline on the request path. */
export const PDF_INLINE_MEDIA_LIMIT = 60;

/** Longest edge for embedded photos / posters (display quality). */
const EMBED_MAX_EDGE = 960;
const EMBED_JPEG_QUALITY = 72;

export type PdfImageData = {
  mediaId: string;
  /** data URI jpeg */
  dataUri: string;
  kind: "photo" | "video_poster";
};

export type PdfBuildResult = {
  bytes: Buffer;
  byteSize: number;
  embeddedImageCount: number;
};

const colors = {
  navy: "#0B1F3A",
  muted: "#5A6A7A",
  border: "#D8DEE6",
  yellow: "#F5C518",
  paper: "#FFFFFF",
  soft: "#F5F7FA",
  ai: "#1A3A5C",
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
  coverPage: {
    paddingTop: 56,
    paddingBottom: 72,
    paddingHorizontal: 48,
    fontFamily: "Helvetica",
    color: colors.navy,
    backgroundColor: colors.paper,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 36,
  },
  brandMark: {
    width: 42,
    height: 42,
    objectFit: "contain",
  },
  brandName: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    color: colors.navy,
  },
  brandSub: {
    fontSize: 10,
    color: colors.muted,
    marginTop: 2,
  },
  coverAccent: {
    height: 4,
    width: 72,
    backgroundColor: colors.yellow,
    marginBottom: 20,
  },
  coverTitle: {
    fontSize: 26,
    fontFamily: "Helvetica-Bold",
    marginBottom: 8,
    lineHeight: 1.25,
  },
  coverAddress: {
    fontSize: 12,
    color: colors.muted,
    marginBottom: 28,
  },
  metaGrid: {
    marginBottom: 28,
    gap: 8,
  },
  metaRow: {
    flexDirection: "row",
    gap: 8,
  },
  metaLabel: {
    width: 110,
    fontSize: 9,
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  metaValue: {
    flex: 1,
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
  },
  coverPhoto: {
    width: "100%",
    maxHeight: 320,
    objectFit: "contain",
    borderRadius: 4,
    marginTop: 8,
  },
  coverPhotoPlaceholder: {
    height: 180,
    backgroundColor: colors.soft,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionTitle: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    color: colors.navy,
    marginBottom: 12,
    marginTop: 8,
    paddingBottom: 6,
    borderBottomWidth: 1.5,
    borderBottomColor: colors.yellow,
  },
  itemBlock: {
    marginBottom: 18,
    paddingBottom: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
  },
  itemTitle: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    marginBottom: 4,
  },
  itemStatus: {
    fontSize: 9,
    color: colors.muted,
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  fieldLabel: {
    fontSize: 8,
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 8,
    marginBottom: 3,
  },
  fieldBody: {
    fontSize: 10,
    lineHeight: 1.45,
    color: colors.navy,
  },
  aiBox: {
    marginTop: 8,
    padding: 8,
    backgroundColor: colors.soft,
    borderLeftWidth: 3,
    borderLeftColor: colors.ai,
  },
  aiLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: colors.ai,
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  photoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
  },
  photoCell: {
    width: "48%",
    marginBottom: 8,
  },
  photoImg: {
    width: "100%",
    objectFit: "contain",
    borderRadius: 2,
  },
  videoBadge: {
    marginTop: 4,
    fontSize: 8,
    color: colors.muted,
    fontFamily: "Helvetica-Bold",
  },
  transcriptBox: {
    marginTop: 6,
    padding: 6,
    backgroundColor: colors.soft,
    borderRadius: 2,
  },
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
  footerLeft: {
    width: "28%",
    textAlign: "left",
  },
  footerCenter: {
    width: "44%",
    textAlign: "center",
  },
  footerRight: {
    width: "28%",
    textAlign: "right",
  },
  muted: {
    color: colors.muted,
    fontSize: 10,
  },
});

function formatAnswer(value: string | string[] | null | undefined): string {
  if (value == null || value === "") return "—";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  return value;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

async function resizeToJpegDataUri(bytes: Buffer): Promise<string | null> {
  try {
    const sharp = (await import("sharp")).default;
    const out = await sharp(bytes)
      .rotate()
      .resize({
        width: EMBED_MAX_EDGE,
        height: EMBED_MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: EMBED_JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
    return `data:image/jpeg;base64,${out.toString("base64")}`;
  } catch (error) {
    console.warn("[site-inspection-pdf] image resize failed", error);
    return null;
  }
}

async function loadLogoDataUri(): Promise<string | null> {
  try {
    const branding = await getBrandingWithLogo();
    if (branding.logoStoragePath) {
      const env = getEnv();
      if (env.ENABLE_MOCK_RESEARCH && env.NODE_ENV !== "production") {
        return null;
      }
      const supabase = createServiceClient();
      const { data, error } = await supabase.storage
        .from(BRANDING_ASSETS_BUCKET)
        .download(branding.logoStoragePath);
      if (!error && data) {
        const buf = Buffer.from(await data.arrayBuffer());
        return resizeToJpegDataUri(buf);
      }
    }
  } catch {
    /* brand logo optional */
  }
  return null;
}

async function collectImages(inspection: SiteInspectionDetail): Promise<Map<string, PdfImageData>> {
  const map = new Map<string, PdfImageData>();
  const ready = inspection.media
    .filter((m) => m.uploadStatus === "ready")
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder);

  for (const m of ready) {
    try {
      if (m.mediaType === "photo" && m.storagePath) {
        const downloaded = await downloadSiteInspectionMediaBytes(m.storagePath);
        if (!downloaded) continue;
        const dataUri = await resizeToJpegDataUri(downloaded.bytes);
        if (dataUri) map.set(m.id, { mediaId: m.id, dataUri, kind: "photo" });
      } else if (m.mediaType === "video" && m.storagePath) {
        const path = posterStoragePathForVideo(m.storagePath);
        const downloaded = await downloadSiteInspectionMediaBytes(path);
        if (!downloaded) continue;
        const dataUri = await resizeToJpegDataUri(downloaded.bytes);
        if (dataUri) map.set(m.id, { mediaId: m.id, dataUri, kind: "video_poster" });
      }
    } catch (error) {
      console.warn("[site-inspection-pdf] skip media", m.id, error);
    }
  }
  return map;
}

function PageFooter({ projectName, companyName }: { projectName: string; companyName: string }) {
  return (
    <View style={styles.footer} fixed>
      <Text style={styles.footerLeft}>{companyName}</Text>
      <Text style={styles.footerCenter}>
        {projectName.length > 36 ? `${projectName.slice(0, 34)}…` : projectName} — Site Inspection
      </Text>
      <Text
        style={styles.footerRight}
        render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
      />
    </View>
  );
}

function ItemBody(props: {
  item: SnapshotItem;
  inspection: SiteInspectionDetail;
  images: Map<string, PdfImageData>;
}) {
  const { item, inspection, images } = props;
  const response = inspection.responses.find((r) => r.snapshotItemId === item.id);
  const summary = inspection.itemSummaries.find((s) => s.snapshotItemId === item.id);
  const media = inspection.media
    .filter((m) => m.snapshotItemId === item.id && m.uploadStatus === "ready")
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const photos = media.filter((m) => m.mediaType === "photo");
  const videos = media.filter((m) => m.mediaType === "video");

  return (
    <View style={styles.itemBlock} wrap minPresenceAhead={60}>
      <Text style={styles.itemTitle} minPresenceAhead={56}>
        {item.title}
      </Text>
      <Text style={styles.itemStatus}>{response?.isComplete ? "Completed" : "Incomplete"}</Text>

      {item.subQuestions.map((sq) => {
        const answer = response?.answers?.[sq.id];
        return (
          <View key={sq.id}>
            <Text style={styles.fieldLabel}>{sq.prompt}</Text>
            <Text style={styles.fieldBody}>{formatAnswer(answer?.value)}</Text>
          </View>
        );
      })}

      {response?.notes?.trim() ? (
        <View>
          <Text style={styles.fieldLabel}>Inspector notes</Text>
          <Text style={styles.fieldBody}>{response.notes.trim()}</Text>
        </View>
      ) : null}

      {summary?.summaryText?.trim() && summary.status === "complete" ? (
        <View style={styles.aiBox}>
          <Text style={styles.aiLabel}>AI-generated summary</Text>
          <Text style={styles.fieldBody}>{summary.summaryText.trim()}</Text>
        </View>
      ) : null}

      {photos.length > 0 ? (
        <View wrap={false} minPresenceAhead={100}>
          <Text style={styles.fieldLabel}>Photos</Text>
          <View style={styles.photoGrid}>
            {photos.map((p) => {
              const img = images.get(p.id);
              if (!img) return null;
              return (
                <View key={p.id} style={styles.photoCell} wrap={false}>
                  {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image */}
                  <Image src={img.dataUri} style={styles.photoImg} />
                </View>
              );
            })}
          </View>
        </View>
      ) : null}

      {videos.map((v) => {
        const img = images.get(v.id);
        const transcript =
          v.transcriptText?.trim() ||
          (Array.isArray(v.transcriptSegments)
            ? v.transcriptSegments
                .map((s) => s.text)
                .join(" ")
                .trim()
            : "");
        return (
          <View key={v.id} style={{ marginTop: 8 }}>
            <Text style={styles.fieldLabel}>Video</Text>
            {img ? (
              <View style={{ width: "48%" }}>
                {/* eslint-disable-next-line jsx-a11y/alt-text */}
                <Image src={img.dataUri} style={styles.photoImg} />
                <Text style={styles.videoBadge}>Video recording (poster frame)</Text>
              </View>
            ) : (
              <Text style={styles.muted}>Video attached (poster unavailable)</Text>
            )}
            {transcript ? (
              <View style={styles.transcriptBox}>
                <Text style={styles.fieldLabel}>Transcript</Text>
                <Text style={styles.fieldBody}>{transcript}</Text>
              </View>
            ) : (
              <Text style={styles.muted}>No transcript available for this video.</Text>
            )}
          </View>
        );
      })}

      {!response?.notes?.trim() &&
      !summary?.summaryText?.trim() &&
      photos.length === 0 &&
      videos.length === 0 &&
      item.subQuestions.length === 0 ? (
        <Text style={styles.muted}>No findings recorded for this item.</Text>
      ) : null}
    </View>
  );
}

function SectionPages(props: {
  sectionTitle: string | null;
  items: SnapshotItem[];
  inspection: SiteInspectionDetail;
  images: Map<string, PdfImageData>;
  companyName: string;
}) {
  const { sectionTitle, items, inspection, images, companyName } = props;
  if (items.length === 0) return null;
  return (
    <Page size="LETTER" style={styles.page} wrap>
      {sectionTitle ? <Text style={styles.sectionTitle}>{sectionTitle}</Text> : null}
      {items.map((item) => (
        <ItemBody key={item.id} item={item} inspection={inspection} images={images} />
      ))}
      <PageFooter projectName={inspection.projectName} companyName={companyName} />
    </Page>
  );
}

function InspectionPdfDocument(props: {
  inspection: SiteInspectionDetail;
  images: Map<string, PdfImageData>;
  companyName: string;
  logoDataUri: string | null;
  coverDataUri: string | null;
}) {
  const { inspection, images, companyName, logoDataUri, coverDataUri } = props;
  const standalone = inspection.snapshot.standaloneItems
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const sections = inspection.snapshot.sections
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder) as SnapshotSection[];

  return (
    <Document
      title={`${inspection.projectName} — Site Inspection`}
      author={companyName}
      subject="Site inspection report"
    >
      <Page size="LETTER" style={styles.coverPage}>
        <View style={styles.brandRow}>
          {logoDataUri ? (
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image src={logoDataUri} style={styles.brandMark} />
          ) : (
            <View
              style={{
                width: 42,
                height: 42,
                backgroundColor: colors.navy,
                borderRadius: 4,
              }}
            />
          )}
          <View>
            <Text style={styles.brandName}>{companyName}</Text>
            <Text style={styles.brandSub}>Site Inspection Report</Text>
          </View>
        </View>
        <View style={styles.coverAccent} />
        <Text style={styles.coverTitle}>{inspection.projectName}</Text>
        <Text style={styles.coverAddress}>{inspection.address}</Text>
        <View style={styles.metaGrid}>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Inspector</Text>
            <Text style={styles.metaValue}>
              {inspection.assignedToName ?? inspection.createdByName ?? "—"}
            </Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Inspection date</Text>
            <Text style={styles.metaValue}>
              {formatDate(inspection.aiProcessingFinishedAt ?? inspection.updatedAt)}
            </Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Status</Text>
            <Text style={styles.metaValue}>
              {inspection.status === "complete" ? "Complete" : "Pending"} ·{" "}
              {inspection.completedItemCount} of {inspection.totalItemCount} items
            </Text>
          </View>
        </View>
        {coverDataUri ? (
          // eslint-disable-next-line jsx-a11y/alt-text
          <Image src={coverDataUri} style={styles.coverPhoto} />
        ) : (
          <View style={styles.coverPhotoPlaceholder}>
            <Text style={styles.muted}>No cover photo</Text>
          </View>
        )}
        <PageFooter projectName={inspection.projectName} companyName={companyName} />
      </Page>

      {standalone.length > 0 ? (
        <SectionPages
          sectionTitle={null}
          items={standalone}
          inspection={inspection}
          images={images}
          companyName={companyName}
        />
      ) : null}

      {sections.map((section) => (
        <SectionPages
          key={section.id}
          sectionTitle={section.title}
          items={section.items.slice().sort((a, b) => a.sortOrder - b.sortOrder)}
          inspection={inspection}
          images={images}
          companyName={companyName}
        />
      ))}
    </Document>
  );
}

export function pdfExportStoragePath(inspectionId: string): string {
  return `${inspectionId}/exports/site-inspection-report.pdf`;
}

export async function buildSiteInspectionPdf(
  inspection: SiteInspectionDetail,
): Promise<PdfBuildResult> {
  const branding = await getBrandingWithLogo();
  const [logoDataUri, images] = await Promise.all([loadLogoDataUri(), collectImages(inspection)]);

  let coverDataUri: string | null = null;
  if (inspection.coverMediaId) {
    coverDataUri = images.get(inspection.coverMediaId)?.dataUri ?? null;
    if (!coverDataUri) {
      const cover = inspection.media.find((m) => m.id === inspection.coverMediaId);
      if (cover?.storagePath) {
        const downloaded = await downloadSiteInspectionMediaBytes(cover.storagePath);
        if (downloaded) coverDataUri = await resizeToJpegDataUri(downloaded.bytes);
      }
    }
  }

  // Avoid unused Font import tree-shaking issues in some bundlers
  void Font;

  const doc = (
    <InspectionPdfDocument
      inspection={inspection}
      images={images}
      companyName={branding.companyName || "Acton ADU"}
      logoDataUri={logoDataUri}
      coverDataUri={coverDataUri}
    />
  );

  const instance = pdf(doc);
  const blob = await instance.toBlob();
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);

  return {
    bytes,
    byteSize: bytes.byteLength,
    embeddedImageCount: images.size,
  };
}

export async function storeSiteInspectionPdf(input: {
  inspectionId: string;
  bytes: Buffer;
}): Promise<string> {
  const path = pdfExportStoragePath(input.inspectionId);
  await uploadSiteInspectionMediaBytes({
    storagePath: path,
    bytes: input.bytes,
    mimeType: "application/pdf",
  });
  return path;
}

/** Count embeddable media units (photos + video posters). */
export function countPdfEmbeddableMedia(inspection: SiteInspectionDetail): number {
  return inspection.media.filter((m) => m.uploadStatus === "ready").length;
}
