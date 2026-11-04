import { Suspense } from "react";
import { ModelWorkspace } from "@/components/configurator/admin/model-workspace";

export default async function ConfiguratorModelPage({
  params,
}: {
  params: Promise<{ modelId: string }>;
}) {
  const { modelId } = await params;
  return (
    <Suspense>
      <ModelWorkspace modelId={decodeURIComponent(modelId)} />
    </Suspense>
  );
}
