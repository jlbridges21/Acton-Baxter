"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Print/PDF export for a completed PEM NEAT — same window.print() pattern as Property Research. */
export function ExportPemNeatPdfButton() {
  return (
    <Button
      type="button"
      variant="accent"
      size="sm"
      data-testid="pem-neat-export-pdf"
      onClick={() => {
        window.print();
      }}
    >
      <Printer className="h-4 w-4" />
      Export as PDF
    </Button>
  );
}
