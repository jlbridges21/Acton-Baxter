import { AppShell } from "@/components/layout/app-shell";
import { QrCodeGenerator } from "@/components/tools/qr-code-generator";
import { requireActiveUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function QrCodePage() {
  const user = await requireActiveUser();

  return (
    <AppShell user={user}>
      <div className="mx-auto w-full max-w-lg space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--acton-navy)]">QR Code Generator</h1>
          <p className="mt-1 text-sm text-[var(--acton-muted)]">
            Paste a link or a short message, then download a PNG or a print-ready SVG. Nothing is
            saved.
          </p>
        </div>
        <QrCodeGenerator />
      </div>
    </AppShell>
  );
}
