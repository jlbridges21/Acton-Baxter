export type {
  AssembleCustomerDossierInput,
  CustomerDossier,
  DossierSectionStatus,
  DossierGhlSection,
  DossierPemSection,
  DossierProjectSetupSection,
  DossierMonitoringSection,
} from "./types";
export { assembleCustomerDossier } from "./assemble";
export type { AssembleCustomerDossierDeps } from "./assemble";
export { formatDossierChatSummary, isBroadDossierQuestion } from "./format";
export { GHL_PROJECT_TYPE_CONSIDERING_LABEL, resolveCustomFieldValueByLabel } from "./ghl-fields";
export {
  listProjectSetupRunsForGhlContact,
  pickPreferredCompleteRunWithSlackChannel,
} from "./project-setup-for-contact";
export type { LinkedProjectSetupRun } from "./project-setup-for-contact";
export { resolveProjectSlackChannelForContact } from "./project-slack-channel-resolve";
export type { ResolvedProjectSlackChannel } from "./project-slack-channel-resolve";
