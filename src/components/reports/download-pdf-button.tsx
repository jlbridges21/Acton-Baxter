"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function DownloadPdfButton() {
  return (
    <Button
      type="button"
      variant="accent"
      onClick={() => {
        window.print();
      }}
    >
      <Printer className="h-4 w-4" />
      Download / Print PDF
    </Button>
  );
}
