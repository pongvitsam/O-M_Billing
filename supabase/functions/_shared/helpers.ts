import { getSupabase } from './context.ts';
import { isPasswordHashed, hashPassword, verifyPassword } from './crypto.ts';

export const LOCALHOST_ONLY_MSG = 'ใช้ได้เฉพาะ Localhost';

export function truncateRemarks(val: unknown): string {
  const s = val == null ? '' : String(val);
  return s.length > 2000 ? s.substring(0, 2000) : s;
}

export function normalizeStatusPeriodKey(projectId: unknown, period: unknown): string {
  const id = String(projectId || '').trim();
  let p = String(period || '').trim();
  if (!id || !p) return '';
  const m = p.match(/^(\d{4})-(\d{1,2})$/);
  if (m) p = m[1] + '-' + parseInt(m[2], 10);
  return id + '_' + p;
}

export function normalizeStatusPeriodKeyFromStored(storedKey: unknown): string {
  const s = String(storedKey || '').trim();
  const lastU = s.lastIndexOf('_');
  if (lastU < 0) return s;
  return normalizeStatusPeriodKey(s.substring(0, lastU), s.substring(lastU + 1));
}

export function getActiveUserEmail(fallbackUser?: string): string {
  return fallbackUser || 'SYSTEM';
}

export function isAuthorizedUser(_user: unknown): boolean {
  return true;
}

export async function logAction(action: string, detail: string, user?: string): Promise<void> {
  try {
    const supabase = getSupabase();
    await supabase.from('Logs').insert({
      Timestamp: new Date().toISOString(),
      User: user || getActiveUserEmail(),
      Action: action,
      Detail: detail,
    });
  } catch (_e) { /* skip */ }
}

export async function logAuditRecord(
  userName: string | undefined,
  entityType: string,
  entityId: string,
  action: string,
  detail: string,
): Promise<void> {
  try {
    const supabase = getSupabase();
    await supabase.from('AuditLog').insert({
      Timestamp: new Date().toISOString(),
      UserName: userName || getActiveUserEmail(),
      EntityType: entityType || '',
      EntityID: entityId || '',
      Action: action || '',
      Detail: detail || '',
    });
  } catch (_e) { /* skip */ }
}

export function yearMonthToInt(ym: unknown): number | null {
  const m = String(ym || '').trim().match(/^(\d{4})-(\d{1,2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 100 + parseInt(m[2], 10);
}

export function periodKeyToInt(periodKey: unknown): number | null {
  const s = String(periodKey || '').trim();
  const lastU = s.lastIndexOf('_');
  if (lastU < 0) return null;
  return yearMonthToInt(s.substring(lastU + 1));
}

export function statusPeriodInRange(periodKey: unknown, from: unknown, to: unknown): boolean {
  const v = periodKeyToInt(periodKey);
  if (v == null) return true;
  const f = from ? yearMonthToInt(from) : null;
  const t = to ? yearMonthToInt(to) : null;
  if (f != null && v < f) return false;
  if (t != null && v > t) return false;
  return true;
}

export function applySettingsDefaults(settings: Record<string, unknown>): Record<string, unknown> {
  const s = { ...settings };
  if (s.phaseLabel == null || s.phaseLabel === '') s.phaseLabel = 'เฟส';
  if (s.sessionTimeoutMinutes == null || s.sessionTimeoutMinutes === '') {
    s.sessionTimeoutMinutes = '480';
  }
  return s;
}

export async function getSheetDataAsObjects(sheetName: string): Promise<Record<string, unknown>[]> {
  const supabase = getSupabase();
  const { data } = await supabase.from(sheetName).select('*');
  return (data && Array.isArray(data)) ? data as Record<string, unknown>[] : [];
}

export async function getSheetDataAsObjectsTail(
  sheetName: string,
  maxRows = 100,
): Promise<Record<string, unknown>[]> {
  const limit = Math.max(1, maxRows);
  const supabase = getSupabase();
  const { data } = await supabase
    .from(sheetName)
    .select('*')
    .order('id', { ascending: false })
    .limit(limit);
  return (data && Array.isArray(data)) ? data as Record<string, unknown>[] : [];
}

export function normalizeUserRole(role: unknown): string {
  const r = String(role || 'editor').trim().toLowerCase();
  if (r === 'admin') return 'admin';
  if (r === 'guest') return 'guest';
  if (r === 'viewer') return 'viewer';
  return 'editor';
}

export function userDeptList(user: { depts?: string } | null): string[] {
  if (!user) return [];
  return String(user.depts || '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

export function userCanViewDeptVault(
  user: { role?: string; depts?: string } | null,
  department: unknown,
  isPublic: unknown,
): boolean {
  if (!user) return false;
  const role = normalizeUserRole(user.role);
  if (role === 'guest') return false;
  if (role === 'admin') return true;
  if (String(isPublic).toLowerCase() === 'true' || isPublic === true) {
    return role === 'editor' || role === 'viewer';
  }
  if (role === 'viewer') {
    const depts = userDeptList(user as { depts?: string });
    if (depts.indexOf('all') >= 0) return true;
    return depts.indexOf(String(department || '').trim().toLowerCase()) >= 0;
  }
  if (role !== 'editor') return false;
  const depts = userDeptList(user as { depts?: string });
  if (depts.indexOf('all') >= 0) return true;
  return depts.indexOf(String(department || '').trim().toLowerCase()) >= 0;
}

export function userCanEditDeptVault(
  user: { role?: string; depts?: string } | null,
  department: unknown,
): boolean {
  if (!user) return false;
  const role = normalizeUserRole(user.role);
  if (role === 'guest' || role === 'viewer') return false;
  if (role === 'admin') return true;
  if (role !== 'editor') return false;
  const depts = userDeptList(user as { depts?: string });
  if (depts.indexOf('all') >= 0) return true;
  return depts.indexOf(String(department || '').trim().toLowerCase()) >= 0;
}

export function userCanEditProjectDept(
  user: { role?: string; depts?: string } | null,
  department: unknown,
): boolean {
  if (!user || normalizeUserRole(user.role) === 'guest') return false;
  if (normalizeUserRole(user.role) === 'admin') return true;
  if (normalizeUserRole(user.role) === 'viewer') return false;
  if (normalizeUserRole(user.role) !== 'editor') return false;
  const depts = userDeptList(user as { depts?: string });
  if (depts.indexOf('all') >= 0) return true;
  return depts.indexOf(String(department || '').trim().toLowerCase()) >= 0;
}

export function userCanViewProjectDept(
  user: { role?: string; depts?: string } | null,
  department: unknown,
): boolean {
  if (!user || normalizeUserRole(user.role) === 'guest') return false;
  if (normalizeUserRole(user.role) === 'admin' || normalizeUserRole(user.role) === 'viewer') {
    return true;
  }
  return userCanEditProjectDept(user, department);
}

export function userCanEditMaintWorkflow(
  user: { role?: string; depts?: string } | null,
  dept: unknown,
): boolean {
  return userCanEditDeptVault(user, dept);
}

export function deptVaultFormatDate(val: unknown): string {
  if (!val) return '';
  if (val instanceof Date) return val.toISOString();
  return String(val);
}

export function deptVaultSanitizeForClient(item: Record<string, unknown>) {
  return {
    ID: item.ID || '',
    Department: item.Department || '',
    Category: item.Category || 'note',
    Title: item.Title || '',
    Content: item.Content || '',
    URL: item.URL || '',
    Username: item.Username || '',
    hasPassword: !!(item.PasswordEnc),
    ContactName: item.ContactName || '',
    ContactPhone: item.ContactPhone || '',
    ContactEmail: item.ContactEmail || '',
    Tags: item.Tags || '',
    IsPublic: String(item.IsPublic).toLowerCase() === 'true' || item.IsPublic === true,
    CreatedBy: item.CreatedBy || '',
    CreatedAt: deptVaultFormatDate(item.CreatedAt),
    UpdatedBy: item.UpdatedBy || '',
    UpdatedAt: deptVaultFormatDate(item.UpdatedAt),
  };
}

export function normalizeActualDateKey(val: unknown): string {
  if (val == null || val === '') return '';
  if (val instanceof Date && !isNaN(val.getTime())) {
    return formatDateISO(val);
  }
  const s = String(val).trim();
  if (!s) return '';
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
  const parts = s.split(/[\s\-\/]+/)
    .map((p) => parseInt(p, 10))
    .filter((n) => !isNaN(n));
  if (parts.length >= 3) {
    let d = parts[0], m = parts[1], y = parts[2];
    if (d > 1000) { const t = d; d = y; y = t; }
    if (y > 2500) y -= 543;
    else if (y >= 50 && y <= 99) y += 1957;
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    }
  }
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) return formatDateISO(parsed);
  return s;
}

export function parseDateOnly(val: unknown): Date | null {
  if (!val) return null;
  if (val instanceof Date && !isNaN(val.getTime())) {
    return new Date(val.getFullYear(), val.getMonth(), val.getDate());
  }
  const s = String(val).trim();
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  const d = new Date(s);
  if (!isNaN(d.getTime())) return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return null;
}

export function formatDateISO(d: Date | null): string {
  if (!d || isNaN(d.getTime())) return '';
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

export function computeLicenseExpiryDate(startDate: unknown, durationYears: unknown): string {
  const start = parseDateOnly(startDate);
  const years = parseFloat(String(durationYears));
  if (!start || isNaN(years) || years <= 0) return '';
  const exp = new Date(start.getTime());
  exp.setFullYear(exp.getFullYear() + Math.round(years));
  return formatDateISO(exp);
}

export function computeLicenseDurationYears(startDate: unknown, expiryDate: unknown): number {
  const start = parseDateOnly(startDate);
  const exp = parseDateOnly(expiryDate);
  if (!start || !exp || exp.getTime() <= start.getTime()) return NaN;
  const diffMs = exp.getTime() - start.getTime();
  const years = diffMs / (365.25 * 24 * 60 * 60 * 1000);
  return Math.round(years * 10) / 10;
}

export function toJsonb(val: unknown): unknown {
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch (_e) { return val; }
  }
  return val || [];
}

export async function getUserRecord(userName: unknown): Promise<{
  username: string;
  role: string;
  depts: string;
} | null> {
  if (!userName) return null;
  const supabase = getSupabase();
  const { data } = await supabase
    .from('Users')
    .select('Username, Role, Depts')
    .eq('Username', String(userName).trim());
  if (!data || data.length === 0) return null;
  const r = data[0];
  return {
    username: r.Username as string,
    role: normalizeUserRole(r.Role),
    depts: (r.Depts as string) || '',
  };
}

export async function verifyUserCredentials(
  username: unknown,
  password: unknown,
): Promise<{ username: string; role: string; depts: string } | null> {
  try {
    if (!username || !password) return null;
    if (String(username).length > 100 || String(password).length > 200) return null;
    const supabase = getSupabase();
    const { data } = await supabase
      .from('Users')
      .select('*')
      .eq('Username', String(username).trim());
    if (!data || data.length === 0) return null;
    const uIn = String(username).trim().toLowerCase();
    for (const r of data) {
      if (
        String(r.Username).trim().toLowerCase() === uIn &&
        verifyPassword(String(password), r.Password)
      ) {
        return { username: r.Username as string, role: r.Role as string, depts: (r.Depts as string) || 'ALL' };
      }
    }
    return null;
  } catch (_e) {
    return null;
  }
}

export async function ensureDefaultLicenseTypes(): Promise<void> {
  const supabase = getSupabase();
  const { data } = await supabase.from('LicenseTypes').select('ID').limit(1);
  if (data && data.length > 0) return;
  await supabase.from('LicenseTypes').insert({
    ID: 'LT-OTHER',
    Name: 'อื่นๆ (ระบุเอง)',
    AlertDays: 90,
    IsOther: true,
    SortOrder: 999,
    Active: true,
  });
}

export async function ensureSettingsDefaults(): Promise<void> {
  const defaults: Record<string, string> = {
    phaseLabel: 'เฟส',
    sessionTimeoutMinutes: '480',
  };
  const rows = await getSheetDataAsObjects('Settings');
  const existing: Record<string, boolean> = {};
  rows.forEach((r) => { if (r.Key) existing[String(r.Key)] = true; });
  const supabase = getSupabase();
  for (const k in defaults) {
    if (!existing[k]) {
      await supabase.from('Settings').upsert({ Key: k, Value: defaults[k] }, { onConflict: 'Key' });
    }
  }
}

export async function initSheets(): Promise<void> {
  await ensureDefaultLicenseTypes();
  await ensureSettingsDefaults();
}

export { isPasswordHashed, hashPassword, verifyPassword };
