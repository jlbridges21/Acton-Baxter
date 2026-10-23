/**
 * The "Start from a template" gallery on /reports: exactly these four, in this order.
 * Other templates (e.g. Sales Commissions) still exist and stay available under the Templates
 * tab and through Dexter — they are only left out of the default gallery.
 */
export const GALLERY_TEMPLATE_KEYS = [
  "active_projects",
  "design_handoff",
  "product_library",
  "blank",
] as const;

export function galleryTemplates<
  T extends { templateKey: string | null; isTemplate: boolean; status: string },
>(reports: T[]): T[] {
  return GALLERY_TEMPLATE_KEYS.map((k) =>
    reports.find((r) => r.isTemplate && r.status === "active" && r.templateKey === k),
  ).filter((r): r is T => Boolean(r));
}
