import { Suspense } from "react";
import { PricingGrid } from "@/components/configurator/admin/pricing-grid";

export default function ConfiguratorPricingPage() {
  return (
    <Suspense>
      <PricingGrid />
    </Suspense>
  );
}
