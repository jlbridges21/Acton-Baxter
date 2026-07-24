export type BaxterTool = {
  key: string;
  name: string;
  description: string;
  href: string;
  enabled: boolean;
  adminOnly?: boolean;
};

/**
 * Registry of Baxter platform tools.
 * Only enabled tools appear as actionable cards on the Baxter Dashboard.
 */
export const BAXTER_TOOLS: BaxterTool[] = [
  {
    key: "property-research",
    name: "Property Research Tool",
    description: "Research property, parcel, zoning, and planning information for PEM preparation.",
    href: "/reports/new",
    enabled: true,
  },
];

export function getEnabledBaxterTools(options?: { isAdmin?: boolean }): BaxterTool[] {
  const isAdmin = options?.isAdmin ?? false;
  return BAXTER_TOOLS.filter((tool) => {
    if (!tool.enabled) return false;
    if (tool.adminOnly && !isAdmin) return false;
    return true;
  });
}
