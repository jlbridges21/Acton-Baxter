/**
 * Master Project Log registry — authoritative Acton project rows from the
 * configured Project Charter Master spreadsheet (project_setup_settings).
 */

export type ProjectLogRow = {
  projectNumber: string;
  shortName: string;
  salesperson: string;
  startDate: string;
  customerName: string;
  street: string;
  city: string;
  postalCode: string;
  jurisdiction: string;
  /** 1-based sheet row for citation. */
  rowNumber: number;
};

export type ProjectRegistryField =
  | "city"
  | "street"
  | "postal"
  | "jurisdiction"
  | "salesperson"
  | "project_number"
  | "customer_name"
  | "short_name"
  | "start_date"
  | "address";

export type ProjectRegistryQuery =
  | {
      kind: "field_lookup";
      projectQuery: string;
      field: ProjectRegistryField;
    }
  | {
      kind: "project_identity";
      projectQuery: string;
    }
  | {
      kind: "filter_city";
      city: string;
    }
  | {
      kind: "count";
      city?: string | null;
      salesperson?: string | null;
      year?: number | null;
    };

export type ProjectRegistryLoadResult = {
  rows: ProjectLogRow[];
  spreadsheetId: string;
  tabName: string;
  fetchedAt: string;
  fromCache: boolean;
};
