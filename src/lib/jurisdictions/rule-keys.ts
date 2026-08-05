/**
 * Typed rule-key vocabulary for structured jurisdiction_rules.
 * Extensible in code without a migration — unknown keys remain valid in DB
 * (namespaced snake_case) so admins can add ahead of product consumers.
 *
 * Downstream consumers (next prompts):
 * - fire_sprinkler_hydrant_distance_max_ft — hydrant distance / sprinkler trigger
 * - adu_setback_*_ft — zone-aware setbacks
 * - adu_max_height_ft / adu_max_size_sqft — envelope limits
 */

export const JURISDICTION_RULE_KEYS = [
  "fire_sprinkler_hydrant_distance_max_ft",
  "adu_setback_front_ft",
  "adu_setback_side_ft",
  "adu_setback_rear_ft",
  "adu_max_height_ft",
  "adu_max_size_sqft",
] as const;

export type KnownJurisdictionRuleKey = (typeof JURISDICTION_RULE_KEYS)[number];

export type JurisdictionRuleKeyMeta = {
  key: KnownJurisdictionRuleKey;
  label: string;
  description: string;
  /** Preferred value_json shape hint for admin UI. */
  valueHint: "quantity_ft" | "quantity_sqft";
};

export const JURISDICTION_RULE_KEY_CATALOG: JurisdictionRuleKeyMeta[] = [
  {
    key: "fire_sprinkler_hydrant_distance_max_ft",
    label: "Fire sprinkler — max hydrant distance (ft)",
    description:
      "Maximum distance to a fire hydrant before residential fire sprinklers are typically required.",
    valueHint: "quantity_ft",
  },
  {
    key: "adu_setback_front_ft",
    label: "ADU front setback (ft)",
    description: "Minimum front-yard setback for ADUs. Use zone_key when zone-specific.",
    valueHint: "quantity_ft",
  },
  {
    key: "adu_setback_side_ft",
    label: "ADU side setback (ft)",
    description: "Minimum side-yard setback for ADUs. Use zone_key when zone-specific.",
    valueHint: "quantity_ft",
  },
  {
    key: "adu_setback_rear_ft",
    label: "ADU rear setback (ft)",
    description: "Minimum rear-yard setback for ADUs. Use zone_key when zone-specific.",
    valueHint: "quantity_ft",
  },
  {
    key: "adu_max_height_ft",
    label: "ADU max height (ft)",
    description: "Maximum ADU building height in feet.",
    valueHint: "quantity_ft",
  },
  {
    key: "adu_max_size_sqft",
    label: "ADU max size (sq ft)",
    description: "Maximum ADU floor area in square feet.",
    valueHint: "quantity_sqft",
  },
];

const RULE_KEY_FORMAT = /^[a-z][a-z0-9_]*$/;

export function isKnownJurisdictionRuleKey(value: string): value is KnownJurisdictionRuleKey {
  return (JURISDICTION_RULE_KEYS as readonly string[]).includes(value);
}

export function isValidJurisdictionRuleKey(value: string): boolean {
  return RULE_KEY_FORMAT.test(value.trim());
}

export function getJurisdictionRuleKeyLabel(ruleKey: string): string {
  const known = JURISDICTION_RULE_KEY_CATALOG.find((item) => item.key === ruleKey);
  if (known) return known.label;
  return ruleKey.replace(/_/g, " ");
}

export function defaultUnitForRuleKey(ruleKey: string): string {
  if (ruleKey.endsWith("_sqft")) return "sqft";
  if (ruleKey.endsWith("_ft")) return "ft";
  return "";
}
