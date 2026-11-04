import { MediaPage } from "@/components/configurator/admin/media-page";
import { getImportReport } from "@/lib/configurator/store";

export const dynamic = "force-dynamic";

export default async function ConfiguratorMediaPage() {
  const report = await getImportReport().catch(() => null);
  return <MediaPage report={report as Parameters<typeof MediaPage>[0]["report"]} />;
}
