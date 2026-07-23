"use client";

import { useRouter } from "next/navigation";
import { CompanyLogo } from "@/components/branding/company-logo";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";

export function PendingAccessClient({
  fullName,
  email,
  logoUrl = null,
  companyName = "Acton ADU",
  reportTitle = "Property Research",
  logoAlt = "Acton ADU logo",
}: {
  fullName: string;
  email: string;
  logoUrl?: string | null;
  companyName?: string;
  reportTitle?: string;
  logoAlt?: string;
}) {
  const router = useRouter();

  async function handleLogout() {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch {
      // Ignore missing session.
    }
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--acton-gray-50)] px-4">
      <div className="w-full max-w-lg space-y-6">
        <CompanyLogo
          href="/pending-access"
          className="justify-center"
          logoUrl={logoUrl}
          companyName={companyName}
          reportTitle={reportTitle}
          alt={logoAlt}
        />
        <Card>
          <CardTitle>Access pending</CardTitle>
          <CardDescription className="mt-2">
            Thanks{fullName ? `, ${fullName}` : ""}. Your account ({email || "signed in"}) was
            created with the <strong>new_user</strong> role. You cannot run property research until
            an administrator grants salesperson or admin access in Supabase or via Admin → Users.
          </CardDescription>
          <div className="mt-6">
            <Button type="button" variant="secondary" onClick={() => void handleLogout()}>
              Sign out
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
