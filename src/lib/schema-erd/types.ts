export type SchemaColumn = {
  name: string;
  dataType: string;
  nullable: boolean;
  primaryKey: boolean;
};

export type SchemaTable = {
  name: string;
  columns: SchemaColumn[];
};

export type SchemaForeignKey = {
  constraintName: string;
  sourceTable: string;
  sourceColumns: string[];
  targetTable: string;
  targetColumns: string[];
};

export type SchemaErd = {
  tables: SchemaTable[];
  foreignKeys: SchemaForeignKey[];
};

export type SchemaGroup = {
  id: string;
  label: string;
  tables: string[];
};

export type SchemaPoint = {
  x: number;
  y: number;
};

export type SchemaNodeSpec = {
  id: string;
  position: SchemaPoint;
  hidden: boolean;
  dimmed: boolean;
  focused: boolean;
  expanded: boolean;
  columns: SchemaColumn[];
  hiddenColumnCount: number;
  foreignKeyColumns: string[];
};

export type SchemaEdgeSpec = {
  id: string;
  source: string;
  target: string;
  label: string;
  self: boolean;
  hidden: boolean;
  dimmed: boolean;
};
