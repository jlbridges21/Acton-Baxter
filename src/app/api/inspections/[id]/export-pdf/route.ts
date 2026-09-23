/**
 * Export site inspection as PDF.
 * Small/medium inspections generate inline; large ones enqueue a background job
 * and return 202 until the file is ready (same idea as oversized zip handling).
 */

import { after } from "next/server";
import { requireActiveUser } from "@/lib/auth/session";
import { jsonError, jsonOk } from "@/lib/api";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { getSiteInspection } from "@/lib/inspections/records-store";
import {
  PDF_INLINE_MEDIA_LIMIT,
  buildSiteInspectionPdf,
  countPdfEmbeddableMedia,
  pdfExportStoragePath,
  storeSiteInspectionPdf,
} from "@/lib/inspections/ai/export-pdf";
import { downloadSiteInspectionMediaBytes } from "@/lib/inspections/media-storage";
import { claimJobById, enqueueJob, getJobById, usesMemoryJobStore } from "@/lib/jobs/queue";
import { processJob } from "@/lib/jobs/process";

export const runtime = "nodejs";
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

function pdfFilename(projectName: string): string {
  const safe = projectName.replace(/[^\w.-]+/g, "_").slice(0, 40) || "inspection";
  return `${safe}-site-inspection.pdf`;
}

export async function GET(request: Request, { params }: Params) {
  try {
    await requireActiveUser();
    const { id: inspectionId } = await params;
    const url = new URL(request.url);
    const jobId = url.searchParams.get("jobId");
    const forceAsync = url.searchParams.get("async") === "1";

    const inspection = await getSiteInspection(inspectionId);
    const embedCount = countPdfEmbeddableMedia(inspection);

    // Poll / download path for a background job.
    if (jobId) {
      const job = await getJobById(jobId);
      if (!job || job.metadata.inspectionId !== inspectionId) {
        throw new NotFoundError("PDF export job not found");
      }
      if (job.status === "failed") {
        throw new ValidationError(job.lastError ?? "PDF export failed");
      }
      if (job.status !== "complete") {
        return jsonOk({
          status: "generating",
          jobId: job.id,
          message: "Building PDF report…",
        });
      }
      const path = pdfExportStoragePath(inspectionId);
      const downloaded = await downloadSiteInspectionMediaBytes(path);
      if (!downloaded) {
        throw new ValidationError("PDF was generated but the file is missing — try again");
      }
      return new Response(new Uint8Array(downloaded.bytes), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${pdfFilename(inspection.projectName)}"`,
          "Content-Length": String(downloaded.bytes.byteLength),
        },
      });
    }

    const useAsync = forceAsync || embedCount > PDF_INLINE_MEDIA_LIMIT;
    if (useAsync) {
      const job = await enqueueJob({
        reportId: null,
        jobType: "site_inspection_pdf_export",
        metadata: {
          inspectionId,
          source: "export_pdf",
          embedCount,
        },
      });

      const run = async () => {
        const claimed = await claimJobById(job.id);
        if (!claimed) return;
        await processJob(claimed);
      };
      if (usesMemoryJobStore()) {
        await run();
        const path = pdfExportStoragePath(inspectionId);
        const downloaded = await downloadSiteInspectionMediaBytes(path);
        if (downloaded) {
          return new Response(new Uint8Array(downloaded.bytes), {
            headers: {
              "Content-Type": "application/pdf",
              "Content-Disposition": `attachment; filename="${pdfFilename(inspection.projectName)}"`,
              "Content-Length": String(downloaded.bytes.byteLength),
            },
          });
        }
      } else {
        after(run);
      }

      return jsonOk(
        {
          status: "generating",
          jobId: job.id,
          message: `This inspection has ${embedCount} media files. Building the PDF in the background — check back in a moment.`,
        },
        { status: 202 },
      );
    }

    console.info("[GET /api/inspections/[id]/export-pdf] building inline", {
      inspectionId,
      embedCount,
    });
    const result = await buildSiteInspectionPdf(inspection);
    // Cache for re-download / future async path.
    await storeSiteInspectionPdf({ inspectionId, bytes: result.bytes }).catch((err) => {
      console.warn("[export-pdf] cache store failed", err);
    });

    console.info("[GET /api/inspections/[id]/export-pdf] ready", {
      inspectionId,
      byteSize: result.byteSize,
      embeddedImageCount: result.embeddedImageCount,
    });

    return new Response(new Uint8Array(result.bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${pdfFilename(inspection.projectName)}"`,
        "Content-Length": String(result.byteSize),
      },
    });
  } catch (error) {
    return jsonError(error, "GET /api/inspections/[id]/export-pdf");
  }
}
