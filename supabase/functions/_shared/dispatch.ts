import {
  getAllData,
  authenticateUser,
  restoreSession,
  invalidateUserSession,
  getAdminUsersData,
  adminSaveUser,
  adminDeleteUser,
  updateSystemSettings,
  updateBulkStatus,
  updateCycleOffset,
  saveProject,
  saveProjectBulk,
  updateFullProject,
  deleteProject,
  updateProjectsPhaseBulk,
  updateMaintenanceVisit,
  deleteMaintenanceVisit,
  startMaintWorkflow,
  saveMaintWorkflowStep,
  completeMaintWorkflow,
  cancelMaintWorkflow,
  listDeptVault,
  saveDeptVaultItem,
  deleteDeptVaultItem,
  revealDeptVaultPassword,
  saveLicenseType,
  deleteLicenseType,
  saveProjectLicense,
  deleteProjectLicense,
  uploadFileToDrive,
  getSystemStatus,
  createDatabaseBackup,
  restoreDatabaseBackup,
  listProjectFiles,
  deleteProjectFile,
  renameProjectFile,
  moveProjectFile,
  createCustomFolder,
  listCustomFolders,
  deleteCustomFolder,
} from './handlers.ts';

type ApiArgs = unknown[];

/** Dispatch API call matching ApiRouter.gs whitelist */
export async function dispatchApiCall(name: string, args: ApiArgs): Promise<unknown> {
  const a = args || [];
  switch (name) {
    case 'getAllData': return getAllData(a[0] as Record<string, unknown>);
    case 'authenticateUser': return authenticateUser(a[0], a[1]);
    case 'restoreSession': return restoreSession(a[0] as string, a[1] as string);
    case 'invalidateUserSession': return invalidateUserSession(a[0]);
    case 'getAdminUsersData': return getAdminUsersData(a[0]);
    case 'adminSaveUser': return adminSaveUser(a[0] as Record<string, unknown>, a[1] as string);
    case 'adminDeleteUser': return adminDeleteUser(a[0], a[1] as string);
    case 'updateSystemSettings':
      return updateSystemSettings(a[0], a[1], a[2] as string, a[3], a[4]);
    case 'updateBulkStatus': return updateBulkStatus(a[0] as Record<string, unknown>[], a[1] as string);
    case 'updateCycleOffset': return updateCycleOffset(a[0], a[1], a[2] as string);
    case 'saveProject': return saveProject(a[0] as Record<string, unknown>);
    case 'saveProjectBulk': return saveProjectBulk(a[0] as Record<string, unknown>[]);
    case 'updateFullProject': return updateFullProject(a[0], a[1] as Record<string, unknown>);
    case 'deleteProject': return deleteProject(a[0], a[1] as string);
    case 'updateProjectsPhaseBulk':
      return updateProjectsPhaseBulk(a[0] as string, a[1] as unknown[], a[2] as unknown[], a[3] as string);
    case 'updateMaintenanceVisit': return updateMaintenanceVisit(a[0] as Record<string, unknown>);
    case 'deleteMaintenanceVisit':
      return deleteMaintenanceVisit(a[0], a[1], a[2], a[3] as string);
    case 'startMaintWorkflow': return startMaintWorkflow(a[0] as Record<string, unknown>, a[1] as string);
    case 'saveMaintWorkflowStep':
      return saveMaintWorkflowStep(a[0] as Record<string, unknown>, a[1] as string);
    case 'completeMaintWorkflow':
      return completeMaintWorkflow(a[0] as Record<string, unknown>, a[1] as string);
    case 'cancelMaintWorkflow': return cancelMaintWorkflow(a[0], a[1] as string);
    case 'listDeptVault': return listDeptVault(a[0] as string);
    case 'saveDeptVaultItem':
      return saveDeptVaultItem(a[0] as Record<string, unknown>, a[1] as string);
    case 'deleteDeptVaultItem': return deleteDeptVaultItem(a[0], a[1] as string);
    case 'revealDeptVaultPassword': return revealDeptVaultPassword(a[0], a[1] as string);
    case 'saveLicenseType':
      return saveLicenseType(a[0] as Record<string, unknown>, a[1] as string);
    case 'deleteLicenseType': return deleteLicenseType(a[0], a[1] as string);
    case 'saveProjectLicense':
      return saveProjectLicense(a[0] as Record<string, unknown>, a[1] as string);
    case 'deleteProjectLicense': return deleteProjectLicense(a[0], a[1] as string);
    case 'uploadFileToDrive':
      return uploadFileToDrive(a[0], a[1], a[2], a[3]);
    case 'getSystemStatus': return getSystemStatus();
    case 'createDatabaseBackup': return createDatabaseBackup();
    case 'restoreDatabaseBackup': return restoreDatabaseBackup();
    case 'listProjectFiles': return listProjectFiles(a[0], a[1] as string);
    case 'deleteProjectFile': return deleteProjectFile(a[0], a[1]);
    case 'renameProjectFile': return renameProjectFile(a[0], a[1], a[2]);
    case 'moveProjectFile': return moveProjectFile(a[0], a[1]);
    case 'createCustomFolder': return createCustomFolder(a[0], a[1], a[2]);
    case 'listCustomFolders': return listCustomFolders(a[0], a[1] as string);
    case 'deleteCustomFolder': return deleteCustomFolder(a[0], a[1]);
    default:
      throw new Error('Unknown API method: ' + name);
  }
}
