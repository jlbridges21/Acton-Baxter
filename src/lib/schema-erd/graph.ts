import type {
  SchemaColumn,
  SchemaEdgeSpec,
  SchemaErd,
  SchemaForeignKey,
  SchemaGroup,
  SchemaNodeSpec,
  SchemaPoint,
  SchemaTable,
} from "@/lib/schema-erd/types";

/** Longest shared name prefix with at least two tables. Leftovers are "Other". */
export function deriveSchemaGroups(tableNames: readonly string[]): SchemaGroup[] {
  const names = [...new Set(tableNames)].sort((a, b) => a.localeCompare(b));
  const prefixes = new Set<string>();
  for (const name of names) {
    const parts = name.split("_");
    for (let length = 1; length < parts.length; length += 1) {
      prefixes.add(parts.slice(0, length).join("_"));
    }
  }
  const valid = [...prefixes]
    .filter((prefix) => names.filter((name) => name.startsWith(`${prefix}_`)).length >= 2)
    .sort((a, b) => b.length - a.length || a.localeCompare(b));
  const groups = new Map<string, string[]>();
  const other: string[] = [];
  for (const name of names) {
    const prefix = valid.find((candidate) => name.startsWith(`${candidate}_`));
    if (!prefix) {
      other.push(name);
      continue;
    }
    const list = groups.get(prefix) ?? [];
    list.push(name);
    groups.set(prefix, list);
  }
  const derived = [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([id, tables]) => ({ id, label: id, tables }));
  if (other.length > 0) derived.push({ id: "other", label: "Other", tables: other });
  return derived;
}

export function foreignKeyColumns(
  tableName: string,
  foreignKeys: readonly SchemaForeignKey[],
): string[] {
  const names = new Set<string>();
  for (const key of foreignKeys) {
    if (key.sourceTable !== tableName) continue;
    for (const column of key.sourceColumns) names.add(column);
  }
  return [...names];
}

export function visibleColumns(
  table: SchemaTable,
  foreignKeys: readonly string[],
  expanded: boolean,
): SchemaColumn[] {
  if (expanded) return table.columns;
  const keys = new Set(foreignKeys);
  return table.columns.filter((column) => column.primaryKey || keys.has(column.name));
}

export function visibleTableNames(input: {
  groups: readonly SchemaGroup[];
  hiddenGroups: ReadonlySet<string>;
  search: string;
  foreignKeys: readonly SchemaForeignKey[];
}): Set<string> {
  const allowed = new Set<string>();
  for (const group of input.groups) {
    if (input.hiddenGroups.has(group.id)) continue;
    for (const table of group.tables) allowed.add(table);
  }
  const query = input.search.trim().toLowerCase();
  if (!query) return allowed;
  const matches = new Set([...allowed].filter((name) => name.toLowerCase().includes(query)));
  const related = new Set(matches);
  for (const key of input.foreignKeys) {
    if (!tablePairKnown(key, allowed)) continue;
    if (matches.has(key.sourceTable)) related.add(key.targetTable);
    if (matches.has(key.targetTable)) related.add(key.sourceTable);
  }
  return related;
}

function tablePairKnown(key: SchemaForeignKey, tables: ReadonlySet<string>): boolean {
  return tables.has(key.sourceTable) && tables.has(key.targetTable);
}

export function focusTableNames(
  focus: string,
  foreignKeys: readonly SchemaForeignKey[],
): Set<string> {
  const names = new Set<string>([focus]);
  for (const key of foreignKeys) {
    if (key.sourceTable === focus) names.add(key.targetTable);
    if (key.targetTable === focus) names.add(key.sourceTable);
  }
  return names;
}

export function relationshipLabel(key: SchemaForeignKey): string {
  return key.sourceColumns
    .map((column, index) => `${column} → ${key.targetColumns[index] ?? ""}`)
    .join(", ");
}

export function countVisibleRelationships(schema: SchemaErd, visible: ReadonlySet<string>): number {
  const publicNames = new Set(schema.tables.map((table) => table.name));
  return schema.foreignKeys.filter((key) => {
    if (!visible.has(key.sourceTable)) return false;
    if (!publicNames.has(key.targetTable)) return true;
    return visible.has(key.targetTable);
  }).length;
}

export function buildSchemaGraph(
  schema: SchemaErd,
  view: {
    positions: Readonly<Record<string, SchemaPoint>>;
    expanded: ReadonlySet<string>;
    hiddenGroups: ReadonlySet<string>;
    search: string;
    focus: string | null;
    /** Tables the selected tool (or the unassigned set) may show. Null shows every table. */
    universe?: ReadonlySet<string> | null;
    /** Seed tables for the selected tool. Neighbors inside the universe are marked linked. */
    seedTables?: ReadonlySet<string> | null;
  },
): { groups: SchemaGroup[]; nodes: SchemaNodeSpec[]; edges: SchemaEdgeSpec[] } {
  const names = schema.tables
    .map((table) => table.name)
    .filter((name) => !view.universe || view.universe.has(name));
  const groups = deriveSchemaGroups(names);
  const visible = visibleTableNames({
    groups,
    hiddenGroups: view.hiddenGroups,
    search: view.search,
    foreignKeys: schema.foreignKeys,
  });
  const focused = view.focus ? focusTableNames(view.focus, schema.foreignKeys) : null;
  const tableNames = new Set(schema.tables.map((table) => table.name));
  const nodes = schema.tables.map((table) => {
    const keys = foreignKeyColumns(table.name, schema.foreignKeys);
    const expanded = view.expanded.has(table.name);
    const columns = visibleColumns(table, keys, expanded);
    const shown = new Set(columns.map((column) => column.name));
    return {
      id: table.name,
      position: view.positions[table.name] ?? { x: 0, y: 0 },
      hidden: !visible.has(table.name),
      dimmed: focused ? !focused.has(table.name) : false,
      focused: view.focus === table.name,
      expanded,
      columns,
      hiddenColumnCount: table.columns.filter((column) => !shown.has(column.name)).length,
      foreignKeyColumns: keys,
      linked: Boolean(
        view.seedTables && visible.has(table.name) && !view.seedTables.has(table.name),
      ),
    };
  });
  const edges = schema.foreignKeys.flatMap((key) => {
    if (!tableNames.has(key.sourceTable) || !tableNames.has(key.targetTable)) return [];
    const self = key.sourceTable === key.targetTable;
    const connected = visible.has(key.sourceTable) && visible.has(key.targetTable);
    const dimmed = focused ? !focused.has(key.sourceTable) || !focused.has(key.targetTable) : false;
    return [
      {
        id: key.constraintName,
        source: key.sourceTable,
        target: key.targetTable,
        label: relationshipLabel(key),
        self,
        hidden: !connected,
        dimmed,
      },
    ];
  });
  return { groups, nodes, edges };
}
