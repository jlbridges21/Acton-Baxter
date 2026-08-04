/**
 * Customer Center — read-only cross-system view types.
 * No PEM→Project Setup actions or suggestions live here.
 */

export type DossierSectionStatus = "ok" | "empty" | "error" | "unavailable" | "omitted";

export type DossierGhlOpportunity = {
  id: string;
  name: string | null;
  pipelineName: string | null;
  stageName: string | null;
  monetaryValue: number | null;
  status: string | null;
};

export type DossierGhlSection = {
  status: DossierSectionStatus;
  contactId: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  /** Street / address line 1 from GHL (already on the contact payload). */
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  /**
   * GHL custom field "What type of project are you considering?" — resolved by
   * field label via customFieldLabels, never by hardcoded field id.
   */
  projectTypeConsidering: string | null;
  ownerName: string | null;
  opportunities: DossierGhlOpportunity[];
  snapshotText: string | null;
  ambiguous: boolean;
  clarificationMessage: string | null;
  error: string | null;
};

export type DossierPemRecord = {
  id: string;
  prospectName: string;
  meetingDate: string | null;
  meetingOutcome: string | null;
  qualification: string | null;
  status: string;
  matchScore: number | null;
  href: string;
};

export type DossierPemSection = {
  status: DossierSectionStatus;
  records: DossierPemRecord[];
  error: string | null;
};

export type DossierProjectSetupRun = {
  id: string;
  status: string;
  projectNumber: string | null;
  dryRun: boolean;
  folderName: string | null;
  charterName: string | null;
  slackChannelName: string | null;
  folderLink: string | null;
  charterLink: string | null;
  /** Display-only channel name/id — no "open Slack" action required. */
  slackChannelId: string | null;
  href: string;
};

export type DossierProjectSetupSection = {
  status: DossierSectionStatus;
  runs: DossierProjectSetupRun[];
  /** Factual empty-state copy only — never a CTA to start setup. */
  emptyMessage: string | null;
  error: string | null;
};

export type DossierMonitoringFinding = {
  id: string;
  title: string;
  severity: string;
  status: string;
  checkKey: string;
  opportunityId: string | null;
  href: string;
};

export type DossierMonitoringSection = {
  status: DossierSectionStatus;
  findings: DossierMonitoringFinding[];
  error: string | null;
};

export type CustomerDossier = {
  query: {
    contactId: string | null;
    pemNeatId: string | null;
    name: string | null;
  };
  identity: {
    displayName: string | null;
    ghlContactId: string | null;
  };
  /** Path to this dossier on the webapp (relative). */
  pagePath: string;
  ghl: DossierGhlSection;
  pemNeats: DossierPemSection;
  projectSetup: DossierProjectSetupSection;
  monitoring: DossierMonitoringSection;
};

export type AssembleCustomerDossierInput = {
  contactId?: string | null;
  pemNeatId?: string | null;
  name?: string | null;
  role?: string | null;
  /**
   * When omitted, derived from role via isAdminRole.
   * Non-admins never receive monitoring findings (section status: omitted).
   */
  includeMonitoring?: boolean;
};
