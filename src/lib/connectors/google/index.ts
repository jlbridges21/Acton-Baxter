export { isGoogleWorkspaceConfigured } from "./auth";
export { GoogleWorkspaceConnector, resolveAndAddFolder } from "./sync";
export {
  listGoogleSyncFolders,
  addGoogleSyncFolder,
  updateGoogleSyncFolder,
  removeGoogleSyncFolder,
  getGoogleSyncFolder,
  resetGoogleFoldersMemoryForTests,
} from "./folders";
export { hashContent, parseGoogleDriveFile, googleOpenLabel, googleSourceKind } from "./parser";

import { GoogleWorkspaceConnector } from "./sync";

export function getGoogleConnector() {
  return new GoogleWorkspaceConnector();
}
