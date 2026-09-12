"use client";

import { Button } from "@/components/ui/button";

/** browser-print trigger for the DSMB / SAE report artifacts (hides itself in print) */
export function PrintButton({ label = "Print summary" }: { label?: string }) {
  return (
    <Button
      variant="outline"
      className="print:hidden"
      onClick={() => window.print()}
    >
      {label}
    </Button>
  );
}
