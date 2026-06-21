import { getSupabase } from './context.ts';
import {
  applySettingsDefaults,
  getSheetDataAsObjects,
  getSheetDataAsObjectsTail,
  statusPeriodInRange,
} from './helpers.ts';

const CACHE_TTL_SECONDS = 21600; // 6 hours

interface CacheEntry {
  data: unknown;
  expiresAt: number;
}

const cacheStore = new Map<string, CacheEntry>();

export function cacheGet(key: string): unknown | null {
  const entry = cacheStore.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cacheStore.delete(key);
    return null;
  }
  return entry.data;
}

export function cachePut(key: string, data: unknown, ttlSeconds = CACHE_TTL_SECONDS): void {
  cacheStore.set(key, { data, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export function invalidateAllDataCache(): void {
  cacheStore.delete('ALL_DATA_CORE_V3');
  cacheStore.delete('ALL_DATA_LOGS_V3');
  cacheStore.delete('DEPT_VAULT_V1');
}

export async function loadAuditLogs(limit = 100): Promise<Record<string, unknown>[]> {
  try {
    const rows = await getSheetDataAsObjectsTail('AuditLog', limit);
    return rows.reverse().map((r) => ({
      Timestamp: r.Timestamp || r.timestamp || '',
      UserName: r.UserName || r.user_name || '',
      EntityType: r.EntityType || r.entity_type || '',
      EntityID: r.EntityID || r.entity_id || '',
      Action: r.Action || r.action || '',
      Detail: r.Detail || r.detail || '',
    }));
  } catch (_e) {
    return [];
  }
}

export function buildStatusesMap(
  rows: Record<string, unknown>[],
  statusFrom: string,
  statusTo: string,
  filterStatuses: boolean,
): Record<string, { status: unknown; inspector: string; execChecked: unknown }> {
  const statuses: Record<string, { status: unknown; inspector: string; execChecked: unknown }> = {};
  rows.forEach((r) => {
    if (!r.PeriodKey) return;
    if (filterStatuses && !statusPeriodInRange(r.PeriodKey, statusFrom, statusTo)) return;
    statuses[String(r.PeriodKey)] = {
      status: r.Status,
      inspector: (r.Inspector as string) || '',
      execChecked: r.ExecChecked || false,
    };
  });
  return statuses;
}

export function buildCycleOverridesMap(rows: Record<string, unknown>[]): Record<string, unknown> {
  const cycleOverrides: Record<string, unknown> = {};
  rows.forEach((r) => {
    if (r.ProjectID) cycleOverrides[String(r.ProjectID)] = r.Offset;
  });
  return cycleOverrides;
}

export function buildSettingsMap(rows: Record<string, unknown>[]): Record<string, unknown> {
  const settings: Record<string, unknown> = {};
  rows.forEach((r) => {
    if (r.Key) settings[String(r.Key)] = r.Value;
  });
  return applySettingsDefaults(settings);
}

export function buildCompaniesList(projects: Record<string, unknown>[]): string[] {
  const companies: string[] = [];
  const compSet: Record<string, boolean> = {};
  projects.forEach((p) => {
    if (p.Company && !compSet[String(p.Company)]) {
      compSet[String(p.Company)] = true;
      companies.push(String(p.Company));
    }
  });
  return companies;
}

export function joinMaintWorkflows(
  workflows: Record<string, unknown>[],
  steps: Record<string, unknown>[],
): Record<string, unknown>[] {
  const stepsByWf: Record<string, Record<string, unknown>[]> = {};
  steps.forEach((s) => {
    const id = String(s.WorkflowID || '');
    if (!stepsByWf[id]) stepsByWf[id] = [];
    stepsByWf[id].push(s);
  });
  return workflows.map((w) => {
    const copy = { ...w };
    copy.Steps = (stepsByWf[String(w.WorkflowID || '')] || []).sort(
      (a, b) => Number(a.StepNo) - Number(b.StepNo),
    );
    return copy;
  });
}

export async function loadMaintWorkflows(): Promise<Record<string, unknown>[]> {
  const workflows = await getSheetDataAsObjects('MaintWorkflow');
  const steps = await getSheetDataAsObjects('MaintWorkflowSteps');
  return joinMaintWorkflows(workflows, steps);
}

interface TableQuery {
  key: string;
  table: string;
  select: string;
  order?: string;
  limit?: number;
}

async function batchFetchTables(
  tableQueries: TableQuery[],
): Promise<Record<string, unknown[] | null>> {
  const supabase = getSupabase();
  const results: Record<string, unknown[] | null> = {};

  await Promise.all(
    tableQueries.map(async (q) => {
      let query = supabase.from(q.table).select(q.select);
      if (q.order) {
        const [col, dir] = q.order.split('.');
        query = query.order(col, { ascending: dir !== 'desc' });
      }
      if (q.limit) query = query.limit(q.limit);
      const { data, error } = await query;
      if (error) {
        console.error(`[batchFetch] ${q.table} failed:`, error.message);
        results[q.key] = null;
      } else {
        results[q.key] = (data as Record<string, unknown>[]) || [];
      }
    }),
  );

  return results;
}

function mapAuditLogs(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((r) => ({
    Timestamp: r.Timestamp || r.timestamp || '',
    UserName: r.UserName || r.user_name || '',
    EntityType: r.EntityType || r.entity_type || '',
    EntityID: r.EntityID || r.entity_id || '',
    Action: r.Action || r.action || '',
    Detail: r.Detail || r.detail || '',
  }));
}

export async function fetchAllDataParallel(
  statusFrom: string,
  statusTo: string,
  filterStatuses: boolean,
  coreOnly: boolean,
) {
  const tables: TableQuery[] = [
    { key: 'projects', table: 'Projects', select: '*' },
    { key: 'maintenance', table: 'Maintenance', select: '*' },
    { key: 'deptsRaw', table: 'Departments', select: '*' },
    { key: 'statusRows', table: 'Statuses', select: 'PeriodKey,Status,Inspector,ExecChecked' },
    { key: 'coRows', table: 'CycleOverrides', select: '*' },
    { key: 'setRows', table: 'Settings', select: '*' },
    { key: 'licenseTypes', table: 'LicenseTypes', select: '*' },
    { key: 'projectLicenses', table: 'ProjectLicenses', select: '*' },
    { key: 'maintWorkflows', table: 'MaintWorkflow', select: '*' },
    { key: 'maintWorkflowSteps', table: 'MaintWorkflowSteps', select: '*' },
  ];
  if (!coreOnly) {
    tables.push({ key: 'logs', table: 'Logs', select: '*', order: 'id.desc', limit: 100 });
    tables.push({ key: 'auditLogs', table: 'AuditLog', select: '*', order: 'id.desc', limit: 100 });
  }

  const batch = await batchFetchTables(tables);
  if (batch.projects == null) return { projects: [] as Record<string, unknown>[] };

  const projects = batch.projects || [];
  const maintenance = batch.maintenance || [];
  const logs = coreOnly ? [] : (batch.logs || []).slice().reverse();
  const auditLogs = coreOnly ? [] : mapAuditLogs((batch.auditLogs || []).slice().reverse());

  const depts = (batch.deptsRaw || [])
    .map((r) => ({ name: r.Name || '', link: r.FolderLink || '' }))
    .filter((d) => d.name);

  const statuses = buildStatusesMap(batch.statusRows || [], statusFrom, statusTo, filterStatuses);
  const cycleOverrides = buildCycleOverridesMap(batch.coRows || []);
  const settings = buildSettingsMap(batch.setRows || []);
  const companies = buildCompaniesList(projects);
  const maintWorkflows = joinMaintWorkflows(batch.maintWorkflows || [], batch.maintWorkflowSteps || []);
  const licenseTypes = (batch.licenseTypes || []).filter(
    (t) => String(t.Active).toLowerCase() !== 'false' && t.Active !== false,
  );

  return {
    projects,
    maintenance,
    logs,
    auditLogs,
    depts,
    statuses,
    cycleOverrides,
    settings,
    companies,
    maintWorkflows,
    licenseTypes,
    projectLicenses: batch.projectLicenses || [],
  };
}

export async function fetchAllDataSequential(
  statusFrom: string,
  statusTo: string,
  filterStatuses: boolean,
  coreOnly: boolean,
) {
  const projects = await getSheetDataAsObjects('Projects');
  const maintenance = await getSheetDataAsObjects('Maintenance');
  const logs = coreOnly ? [] : (await getSheetDataAsObjectsTail('Logs', 100)).reverse();
  const auditLogs = coreOnly ? [] : await loadAuditLogs(100);
  const depts = (await getSheetDataAsObjects('Departments'))
    .map((r) => ({ name: r.Name || '', link: r.FolderLink || '' }))
    .filter((d) => d.name);
  const statuses = buildStatusesMap(
    await getSheetDataAsObjects('Statuses'),
    statusFrom,
    statusTo,
    filterStatuses,
  );
  const cycleOverrides = buildCycleOverridesMap(await getSheetDataAsObjects('CycleOverrides'));
  const settings = buildSettingsMap(await getSheetDataAsObjects('Settings'));
  const companies = buildCompaniesList(projects);
  const maintWorkflows = await loadMaintWorkflows();
  const licenseTypes = (await getSheetDataAsObjects('LicenseTypes')).filter(
    (t) => String(t.Active).toLowerCase() !== 'false' && t.Active !== false,
  );
  return {
    projects,
    maintenance,
    logs,
    auditLogs,
    depts,
    statuses,
    cycleOverrides,
    settings,
    companies,
    maintWorkflows,
    licenseTypes,
    projectLicenses: await getSheetDataAsObjects('ProjectLicenses'),
  };
}

export async function getLogsData(): Promise<Record<string, unknown>> {
  try {
    const cached = cacheGet('ALL_DATA_LOGS_V3') as { logs?: unknown[]; auditLogs?: unknown[] } | null;
    if (cached) {
      return { status: 'success', logs: cached.logs || [], auditLogs: cached.auditLogs || [] };
    }
    const logs = (await getSheetDataAsObjectsTail('Logs', 100)).reverse();
    const auditLogs = await loadAuditLogs(100);
    const payload = { logs, auditLogs };
    cachePut('ALL_DATA_LOGS_V3', payload, CACHE_TTL_SECONDS);
    return { status: 'success', logs, auditLogs };
  } catch (e) {
    return { status: 'error', message: String(e) };
  }
}

export async function getAllData(options: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  try {
    if (options.logsOnly) return getLogsData();

    const statusFrom = options.statusFrom != null ? String(options.statusFrom).trim() : '';
    const statusTo = options.statusTo != null ? String(options.statusTo).trim() : '';
    const filterStatuses = !!(statusFrom || statusTo);
    const coreOnly = !!options.coreOnly;

    const cacheKey = 'ALL_DATA_CORE_V3';
    if (!filterStatuses) {
      const cached = cacheGet(cacheKey) as Record<string, unknown> | null;
      if (cached && cached.status === 'success' && ((cached.projects as unknown[]) || []).length > 0) {
        if (coreOnly) return cached;
        const logsCached = cacheGet('ALL_DATA_LOGS_V3') as { logs?: unknown[]; auditLogs?: unknown[] } | null;
        if (logsCached) {
          cached.logs = logsCached.logs || [];
          cached.auditLogs = logsCached.auditLogs || [];
        }
        return cached;
      }
    }

    let data = await fetchAllDataParallel(statusFrom, statusTo, filterStatuses, coreOnly);
    if (!data.projects || data.projects.length === 0) {
      data = await fetchAllDataSequential(statusFrom, statusTo, filterStatuses, coreOnly);
    }

    const result = {
      status: 'success',
      projects: data.projects,
      departments: data.depts,
      statuses: data.statuses,
      maintenance: data.maintenance,
      maintWorkflows: data.maintWorkflows,
      logs: data.logs || [],
      auditLogs: data.auditLogs || [],
      companies: data.companies,
      cycleOverrides: data.cycleOverrides,
      settings: data.settings,
      statusesPartial: filterStatuses,
      licenseTypes: data.licenseTypes,
      projectLicenses: data.projectLicenses,
    };

    if (!filterStatuses && (result.projects as unknown[]).length > 0) {
      const corePayload = {
        status: 'success',
        projects: result.projects,
        departments: result.departments,
        statuses: result.statuses,
        maintenance: result.maintenance,
        maintWorkflows: result.maintWorkflows,
        companies: result.companies,
        cycleOverrides: result.cycleOverrides,
        settings: result.settings,
        licenseTypes: result.licenseTypes,
        projectLicenses: result.projectLicenses,
        logs: [],
        auditLogs: [],
      };
      cachePut(cacheKey, corePayload, CACHE_TTL_SECONDS);
      if (!coreOnly && ((result.logs as unknown[]).length || (result.auditLogs as unknown[]).length)) {
        cachePut('ALL_DATA_LOGS_V3', { logs: result.logs, auditLogs: result.auditLogs }, CACHE_TTL_SECONDS);
      }
    }

    return result;
  } catch (e) {
    return { status: 'error', message: String(e) };
  }
}

export async function getDeptVaultRowsCached(): Promise<Record<string, unknown>[]> {
  const cacheKey = 'DEPT_VAULT_V1';
  const cached = cacheGet(cacheKey);
  if (cached && Array.isArray(cached)) return cached as Record<string, unknown>[];
  const rows = await getSheetDataAsObjects('DeptVault') || [];
  cachePut(cacheKey, rows, CACHE_TTL_SECONDS);
  return rows;
}

export async function getDataStatus(): Promise<Record<string, unknown>> {
  try {
    invalidateAllDataCache();
    const supabase = getSupabase();
    const { error, status } = await supabase.from('Projects').select('ID').limit(1);
    if (error) {
      let errMsg = error.message || '';
      try {
        const parsed = JSON.parse(errMsg);
        if (parsed.message) errMsg = parsed.message;
      } catch (_e) { /* skip */ }
      return {
        status: 'error',
        message: errMsg,
        httpStatus: status,
        hint: 'อัปเดต SUPABASE_SERVICE_ROLE_KEY หรือตรวจสอบ Supabase Dashboard → Settings → API',
      };
    }
    const data = await getAllData();
    return {
      status: data.status || 'unknown',
      message: data.message || '',
      projectCount: ((data.projects as unknown[]) || []).length,
      maintenanceCount: ((data.maintenance as unknown[]) || []).length,
      departmentCount: ((data.departments as unknown[]) || []).length,
      statusCount: Object.keys((data.statuses as object) || {}).length,
    };
  } catch (e) {
    return { status: 'error', message: String(e) };
  }
}

export async function countTable(name: string): Promise<number> {
  const supabase = getSupabase();
  const { count } = await supabase.from(name).select('*', { count: 'exact', head: true });
  return count || 0;
}
