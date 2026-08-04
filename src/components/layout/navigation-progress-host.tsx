import { Suspense } from "react";
import { NavigationProgress } from "@/components/layout/navigation-progress";

/** Suspense boundary required because NavigationProgress reads useSearchParams. */
export function NavigationProgressHost() {
  return (
    <Suspense fallback={null}>
      <NavigationProgress />
    </Suspense>
  );
}
