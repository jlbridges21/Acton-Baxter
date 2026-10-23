/** Shared (client-safe) report permission shape. */
export type ReportPermission = {
  canView: boolean;
  canEdit: boolean;
  canShare: boolean;
  canDelete: boolean;
};
