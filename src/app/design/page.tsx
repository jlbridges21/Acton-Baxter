import type { Metadata } from "next";
import { headers } from "next/headers";
import Script from "next/script";
import { ConfiguratorApp } from "@/components/configurator/public/configurator-app";
import { isConfiguratorHost } from "@/lib/configurator/public-paths";
import { isAdminPreview } from "@/lib/configurator/request-context";
import { loadPublicCatalog } from "@/lib/configurator/server";
import "./configurator.css";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const host = (await headers()).get("host");
  return {
    title: { absolute: "Acton Adu Configurator" },
    description:
      "Design your Acton ADU: choose a model, exterior and interior styles, appliances and upgrades.",
    // Index only on the real customer domain, never on the Baxter staging URL.
    robots: isConfiguratorHost(host) ? undefined : { index: false, follow: false },
    icons: { icon: "/configurator/ActonADU.svg" },
  };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function toQueryString(params: Record<string, string | string[] | undefined>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") q.set(key, value);
    else if (Array.isArray(value) && value[0]) q.set(key, value[0]);
  }
  return q.toString();
}

export default async function DesignPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const preview = await isAdminPreview(params.preview === "draft");
  const catalog = await loadPublicCatalog({ preview }).catch(() => null);
  const gtmId = process.env.CONFIGURATOR_GTM_ID;

  if (!catalog || catalog.models.length === 0) {
    return (
      <main className="configurator-root flex min-h-screen flex-col items-center justify-center gap-3 bg-white p-8 text-center text-[#2E2A22]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/configurator/ActonADU.svg" alt="Acton ADU" width={150} height={24} />
        <p className="text-lg">The configurator is being updated. Please check back shortly.</p>
        {preview ? (
          <p className="text-sm text-[#6A6A6A]">
            Admin preview: the draft has no models turned on yet.
          </p>
        ) : null}
      </main>
    );
  }

  return (
    <>
      {gtmId && !preview ? (
        <Script id="configurator-gtm" strategy="afterInteractive">
          {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer',${JSON.stringify(gtmId)});`}
        </Script>
      ) : null}
      <ConfiguratorApp catalog={catalog} preview={preview} initialSearch={toQueryString(params)} />
    </>
  );
}
