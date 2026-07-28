/**
 * Tiny PDF fixtures for unit/integration tests (no binary assets in git).
 * Built with a correct xref table so PDF.js recovers full string literals.
 */

function escapePdfString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function buildSimpleTextPdf(pages: string[]): Buffer {
  const pageCount = pages.length;
  const fontObj = 3 + pageCount * 2;
  const objects: string[] = new Array(fontObj + 1).fill("");

  const kids = pages.map((_, i) => `${3 + i * 2} 0 R`).join(" ");
  objects[1] = "1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n";
  objects[2] = `2 0 obj<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>endobj\n`;

  for (let i = 0; i < pageCount; i++) {
    const pageObj = 3 + i * 2;
    const contentObj = pageObj + 1;
    const stream = `BT /F1 18 Tf 72 720 Td (${escapePdfString(pages[i] ?? "")}) Tj ET`;
    objects[pageObj] =
      `${pageObj} 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentObj} 0 R /Resources<< /Font<< /F1 ${fontObj} 0 R >> >> >>endobj\n`;
    objects[contentObj] =
      `${contentObj} 0 obj<< /Length ${Buffer.byteLength(stream, "utf8")} >>stream\n${stream}\nendstream\nendobj\n`;
  }

  objects[fontObj] =
    `${fontObj} 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n`;

  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 1; i <= fontObj; i++) {
    offsets[i] = Buffer.byteLength(body, "utf8");
    body += objects[i];
  }
  const xrefStart = Buffer.byteLength(body, "utf8");
  let xref = `xref\n0 ${fontObj + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= fontObj; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  body += xref;
  body += `trailer<< /Size ${fontObj + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(body, "utf8");
}

/** Single-page PDF with selectable text. */
export function fixtureTextPdf(text = "Hello Baxter"): Buffer {
  return buildSimpleTextPdf([text]);
}

/** Two-page PDF with distinct selectable text per page. */
export function fixtureMultiPageTextPdf(): Buffer {
  return buildSimpleTextPdf(["Page One Unique Token ALPHA", "Page Two Unique Token BRAVO"]);
}

/** Valid PDF with a page but no text operators (image-only / scanned-like). */
export function fixtureImageOnlyPdf(): Buffer {
  const stream = "";
  const objects: string[] = [];
  objects[1] = "1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n";
  objects[2] = "2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n";
  objects[3] =
    "3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>endobj\n";
  objects[4] = `4 0 obj<< /Length ${Buffer.byteLength(stream, "utf8")} >>stream\n${stream}\nendstream\nendobj\n`;

  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 1; i <= 4; i++) {
    offsets[i] = Buffer.byteLength(body, "utf8");
    body += objects[i];
  }
  const xrefStart = Buffer.byteLength(body, "utf8");
  let xref = "xref\n0 5\n0000000000 65535 f \n";
  for (let i = 1; i <= 4; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  body += xref;
  body += `trailer<< /Size 5 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(body, "utf8");
}

/** Corrupt / truncated PDF that starts with a magic header. */
export function fixtureCorruptPdf(): Buffer {
  return Buffer.from("%PDF-1.4\nthis is not a valid pdf structure\n%%EOF", "utf8");
}

/** Empty buffer. */
export function fixtureEmptyPdf(): Buffer {
  return Buffer.alloc(0);
}

/** Non-PDF bytes. */
export function fixtureNotPdf(): Buffer {
  return Buffer.from("PK\x03\x04not-a-pdf", "binary");
}

/**
 * Minimal encrypted PDF that triggers PasswordException in PDF.js / unpdf.
 */
export function fixturePasswordProtectedPdf(): Buffer {
  const objects: string[] = [];
  objects[1] = "1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n";
  objects[2] = "2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n";
  objects[3] =
    "3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>endobj\n";
  objects[4] = "4 0 obj<< /Length 0 >>stream\n\nendstream\nendobj\n";
  objects[5] =
    "5 0 obj<< /Filter /Standard /V 1 /R 2 /O (xxxxxxxxxxxxxxxxxxxx) /U (xxxxxxxxxxxxxxxxxxxx) /P -4 >>endobj\n";

  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 1; i <= 5; i++) {
    offsets[i] = Buffer.byteLength(body, "utf8");
    body += objects[i];
  }
  const xrefStart = Buffer.byteLength(body, "utf8");
  let xref = "xref\n0 6\n0000000000 65535 f \n";
  for (let i = 1; i <= 5; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  body += xref;
  body += `trailer<< /Size 6 /Root 1 0 R /Encrypt 5 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(body, "utf8");
}
