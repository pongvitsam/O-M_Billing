import { getSupabase } from './context.ts';
import { envGet } from './env.ts';
import { shortId, hashPassword, isPasswordHashed, vaultEncrypt, vaultDecrypt } from './crypto.ts';
import { createSession, invalidateSession, restoreSession } from './session.ts';
import {
  truncateRemarks,
  normalizeStatusPeriodKey,
  normalizeUserRole,
  logAction,
  logAuditRecord,
  getUserRecord,
  userCanViewDeptVault,
  userCanEditDeptVault,
  userCanEditProjectDept,
  userCanEditMaintWorkflow,
  deptVaultSanitizeForClient,
  normalizeActualDateKey,
  parseDateOnly,
  formatDateISO,
  computeLicenseDurationYears,
  toJsonb,
  initSheets,
  getSheetDataAsObjects,
  verifyPassword,
  LOCALHOST_ONLY_MSG,
} from './helpers.ts';
import {
  getAllData,
  invalidateAllDataCache,
  getDeptVaultRowsCached,
  countTable,
} from './data.ts';

// ── Auth ───────────────────────────────────────────────────────

export async function authenticateUser(username: unknown, password: unknown) {
  try {
    if (!username || !password) {
      return { status: 'error', message: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' };
    }
    if (String(username).length > 100 || String(password).length > 200) {
      return { status: 'error', message: 'ข้อมูลที่กรอกยาวเกินกำหนด' };
    }
    const supabase = getSupabase();
    const { data } = await supabase.from('Users').select('*').eq('Username', String(username).trim());
    if (!data || data.length === 0) {
      return { status: 'error', message: 'ยังไม่มีบัญชีผู้ใช้ในระบบ' };
    }
    const uIn = String(username).trim().toLowerCase();
    for (const r of data) {
      if (
        String(r.Username).trim().toLowerCase() === uIn &&
        verifyPassword(String(password), r.Password)
      ) {
        if (!isPasswordHashed(r.Password)) {
          await supabase.from('Users').update({ Password: hashPassword(String(password)) })
            .eq('Username', r.Username);
          invalidateAllDataCache();
        }
        await logAction('LOGIN', 'เข้าสู่ระบบสำเร็จ', String(r.Username));
        const token = await createSession(r.Username as string);
        return {
          status: 'success',
          username: r.Username,
          role: normalizeUserRole(r.Role),
          depts: r.Depts || 'ALL',
          token,
        };
      }
    }
    return { status: 'error', message: 'ชื่อผู้ใช้งาน หรือรหัสผ่านไม่ถูกต้อง' };
  } catch (e) {
    return { status: 'error', message: String(e) };
  }
}

export { restoreSession };

export async function invalidateUserSession(token: unknown) {
  const result = await invalidateSession(String(token || ''));
  return result;
}

// ── Admin Users ────────────────────────────────────────────────

export async function getAdminUsersData(_requestingUser: unknown) {
  try {
    const supabase = getSupabase();
    const { data } = await supabase.from('Users').select('*');
    const users = (data || []).map((r) => ({
      username: r.Username,
      hasPassword: !!(r.Password),
      role: r.Role,
      depts: r.Depts,
    }));
    return { status: 'success', users };
  } catch (e) {
    return { status: 'error', message: String(e) };
  }
}

export async function adminSaveUser(uData: Record<string, unknown>, requestingUser: string) {
  try {
    if (!uData || !uData.username) return { status: 'error', message: 'ข้อมูลผู้ใช้ไม่ครบถ้วน' };
    const uName = String(uData.username).trim();
    if (!uName) return { status: 'error', message: 'ชื่อผู้ใช้ว่าง' };
    if (uName.length > 100) return { status: 'error', message: 'ชื่อผู้ใช้ยาวเกินไป' };
    let pWord = uData.password != null ? String(uData.password) : '';
    if (pWord.length > 200) return { status: 'error', message: 'รหัสผ่านยาวเกินไป' };
    const allowedRoles = ['admin', 'editor', 'viewer'];
    let role = normalizeUserRole(uData.role || 'editor');
    if (allowedRoles.indexOf(role) === -1) role = 'editor';
    const depts = uData.depts != null ? String(uData.depts).substring(0, 500) : 'ALL';

    const supabase = getSupabase();
    const { data: check } = await supabase.from('Users').select('Username, Password').eq('Username', uName);
    const isEdit = check && check.length > 0;
    const existingPassword = isEdit ? (check![0].Password || '') : '';

    if (isEdit && !String(pWord).trim()) {
      pWord = String(existingPassword);
    } else if (pWord && !isPasswordHashed(pWord)) {
      pWord = hashPassword(pWord);
    }

    await supabase.from('Users').upsert(
      { Username: uName, Password: pWord, Role: role, Depts: depts },
      { onConflict: 'Username' },
    );
    invalidateAllDataCache();
    await logAction('USER_MGT', (isEdit ? 'แก้ไข' : 'เพิ่ม') + 'ผู้ใช้: ' + uName, requestingUser);
    await logAuditRecord(requestingUser, 'USER', uName, isEdit ? 'UPDATE' : 'CREATE', 'role=' + role + ' depts=' + depts);
    return { status: 'success' };
  } catch (e) {
    return { status: 'error', message: String(e) };
  }
}

export async function adminDeleteUser(username: unknown, requestingUser: string) {
  try {
    if (!username) return { status: 'error', message: 'ไม่ได้ระบุชื่อผู้ใช้' };
    if (String(username).trim().toLowerCase() === 'admin') {
      throw new Error('ไม่อนุญาตให้ลบบัญชี admin หลัก');
    }
    const supabase = getSupabase();
    await supabase.from('Users').delete().eq('Username', String(username).trim());
    invalidateAllDataCache();
    await logAction('USER_MGT', 'ลบผู้ใช้งาน: ' + username, requestingUser);
    return { status: 'success' };
  } catch (e) {
    return { status: 'error', message: String(e) };
  }
}

// ── System Settings ────────────────────────────────────────────

export async function updateSystemSettings(
  bannerText: unknown,
  bannerActive: unknown,
  userName: string,
  phaseLabel?: unknown,
  sessionTimeoutMinutes?: unknown,
) {
  try {
    let safeText = bannerText == null ? '' : String(bannerText);
    if (safeText.length > 2000) safeText = safeText.substring(0, 2000);
    const safeActive = (bannerActive === true || String(bannerActive).toLowerCase() === 'true') ? 'true' : 'false';
    const safePhase = phaseLabel != null ? String(phaseLabel).trim().substring(0, 20) : '';
    let safeTimeout = sessionTimeoutMinutes != null
      ? String(parseInt(String(sessionTimeoutMinutes), 10) || 480)
      : '';
    if (safeTimeout && (parseInt(safeTimeout, 10) < 5 || parseInt(safeTimeout, 10) > 1440)) {
      safeTimeout = '480';
    }
    const supabase = getSupabase();
    await supabase.from('Settings').upsert({ Key: 'BannerText', Value: safeText }, { onConflict: 'Key' });
    await supabase.from('Settings').upsert({ Key: 'BannerActive', Value: safeActive }, { onConflict: 'Key' });
    if (safePhase) await supabase.from('Settings').upsert({ Key: 'phaseLabel', Value: safePhase }, { onConflict: 'Key' });
    if (safeTimeout) {
      await supabase.from('Settings').upsert({ Key: 'sessionTimeoutMinutes', Value: safeTimeout }, { onConflict: 'Key' });
    }
    invalidateAllDataCache();
    await logAction('SYSTEM', 'อัปเดตการตั้งค่าระบบ', userName);
    return { status: 'success' };
  } catch (e) {
    return { status: 'error', message: String(e) };
  }
}

// ── Projects ───────────────────────────────────────────────────

export async function saveProject(data: Record<string, unknown>) {
  return saveProjectBulk([data]);
}

export async function saveProjectBulk(projectsArray: Record<string, unknown>[]) {
  try {
    if (!projectsArray || !Array.isArray(projectsArray) || projectsArray.length === 0) {
      return { status: 'error', message: 'ไม่มีข้อมูลโครงการ' };
    }
    const supabase = getSupabase();
    const rows: Record<string, unknown>[] = [];
    for (const proj of projectsArray) {
      if (!proj || typeof proj !== 'object') continue;
      const existingId = String(proj.ID || proj.id || '').trim();
      let useId: string;
      if (existingId && /^PRJ-/i.test(existingId)) {
        useId = existingId;
      } else {
        useId = existingId || ('PRJ-' + shortId());
      }
      const payload = {
        ID: useId,
        Company: proj.Company != null ? String(proj.Company) : '',
        ProjectName: proj.ProjectName != null ? String(proj.ProjectName) : '',
        ProjectType: proj.ProjectType || proj.projectType || 'single',
        MainProjectName: proj.MainProjectName || proj.mainProjectName || '',
        ShortName: proj.ShortName || proj.shortName || '',
        Phase: proj.Phase || proj.phase || '',
        Department: proj.Department || proj.department || '',
        StartDate: proj.StartDate || proj.startDate || '',
        kWp: proj.kWp != null ? parseFloat(String(proj.kWp)) || 0 : 0,
        PEARegion: proj.PEARegion || proj.peaRegion || '',
        DurationYears: proj.DurationYears || proj.durationYear || 0,
        DurationCycles: proj.DurationCycles || proj.durationCycle || 0,
        MaintFreq: proj.MaintFreq || proj.maintFreq || 0,
        Lat: proj.Lat || proj.lat || '',
        Lng: proj.Lng || proj.lng || '',
        MeterNo: proj.MeterNo || proj.meterNo || proj.METER_NO || '',
        RuleType: proj.RuleType || proj.ruleType || proj.RULE_TYPE || '',
        RuleValue: proj.RuleValue || proj.ruleValue || proj.RULE_VALUE || '',
        VendorContract: proj.VendorContract || proj.vendorContract || '',
        VendorFiles: toJsonb(proj.VendorFiles || proj.vendorFiles || []),
        OwnerContract: proj.OwnerContract || proj.ownerContract || '',
        OwnerFiles: toJsonb(proj.OwnerFiles || proj.ownerFiles || []),
        DefaultInspector: proj.DefaultInspector || proj.inspector || '',
        ProjectFiles: toJsonb(proj.ProjectFiles || proj.projectFiles || []),
        Remarks: truncateRemarks(proj.Remarks !== undefined ? proj.Remarks : proj.remarks),
      };
      await supabase.from('Projects').upsert(payload, { onConflict: 'ID' });
      rows.push(payload);
    }
    invalidateAllDataCache();
    await logAction(
      'บันทึกโครงการ',
      'บันทึก ' + rows.length + ' โครงการ',
      (projectsArray[0] && (projectsArray[0].userName as string)) || 'System',
    );
    return { status: 'success' };
  } catch (error) {
    return { status: 'error', message: String(error) };
  }
}

export async function deleteProject(id: unknown, userName: string) {
  try {
    if (id == null || String(id).trim() === '') {
      return { status: 'error', message: 'ไม่ได้ระบุรหัสโครงการ' };
    }
    const idStr = String(id).trim();
    const supabase = getSupabase();
    const { error, status } = await supabase.from('Projects').delete().eq('ID', idStr);
    if (error && status === 404) return { status: 'error', message: 'ไม่พบข้อมูลที่ต้องการลบ' };
    invalidateAllDataCache();
    await logAction('ลบโครงการ', 'ลบรหัส ' + idStr, userName);
    return { status: 'success' };
  } catch (error) {
    return { status: 'error', message: String(error) };
  }
}

export async function updateFullProject(subIds: unknown, data: Record<string, unknown>) {
  try {
    const subIdStr = subIds == null ? '' : String(subIds);
    const idsToUpdate = subIdStr.split(',').map((s) => String(s || '').trim()).filter(Boolean);
    if (idsToUpdate.length === 0) return { status: 'error', message: 'ไม่ได้ระบุรหัสที่จะอัปเดต' };
    const supabase = getSupabase();
    for (const id of idsToUpdate) {
      const payload = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
      payload.ID = id;
      payload.id = id;
      if (payload.Remarks === undefined && payload.remarks !== undefined) {
        payload.Remarks = truncateRemarks(payload.remarks);
      }
      if (payload.Remarks != null) payload.Remarks = truncateRemarks(payload.Remarks);
      await supabase.from('Projects').update(payload).eq('ID', id);
    }
    invalidateAllDataCache();
    await logAction(
      'แก้ไขโครงการ (Bulk Optimized)',
      'แก้ไขข้อมูลของ ' + (data.Company || data.MainProjectName || ''),
      (data.userName as string) || 'System',
    );
    await logAuditRecord(
      (data.userName as string) || 'System',
      'PROJECT',
      idsToUpdate.join(','),
      'UPDATE',
      'updateFullProject',
    );
    return { status: 'success' };
  } catch (error) {
    return { status: 'error', message: String(error) };
  }
}

export async function updateProjectsPhaseBulk(
  targetPhase: string,
  checkedIds: unknown[],
  uncheckedIds: unknown[],
  userName: string,
) {
  try {
    const safeChecked = (checkedIds || []).map(String);
    const safeUnchecked = (uncheckedIds || []).map(String);
    const supabase = getSupabase();
    for (const id of safeChecked) {
      await supabase.from('Projects').update({ Phase: targetPhase }).eq('ID', id);
    }
    for (const id of safeUnchecked) {
      await supabase.from('Projects').update({ Phase: '' }).eq('ID', id);
    }
    invalidateAllDataCache();
    await logAction('อัปเดตกลุ่มโครงการ', 'อัปเดตสมาชิกเข้ากลุ่มเฟส: ' + targetPhase, userName);
    return { status: 'success' };
  } catch (error) {
    return { status: 'error', message: String(error) };
  }
}

// ── Status ─────────────────────────────────────────────────────

export async function updateBulkStatus(updates: Record<string, unknown>[], userName: string) {
  try {
    if (!updates || !Array.isArray(updates) || updates.length === 0) {
      return { status: 'error', message: 'ไม่มีข้อมูลที่จะอัปเดต' };
    }
    const supabase = getSupabase();
    const statusPatches: Record<string, { status: unknown; inspector: string; execChecked: unknown }> = {};
    const now = new Date().toISOString();

    for (const uData of updates) {
      if (!uData || uData.id == null || uData.period == null) continue;
      const safeId = String(uData.id).trim();
      const safePeriod = String(uData.period).trim();
      if (safeId === '' || safePeriod === '') continue;
      const key = normalizeStatusPeriodKey(safeId, safePeriod);
      const newStat = uData.status !== undefined ? uData.status : 'รอนำส่ง';
      const newInsp = uData.inspector !== undefined ? String(uData.inspector) : '';
      const newExec = uData.execChecked !== undefined ? uData.execChecked : false;

      await supabase.from('Statuses').upsert({
        PeriodKey: key,
        Status: newStat,
        Inspector: newInsp,
        ExecChecked: newExec,
        LastUpdated: now,
      }, { onConflict: 'PeriodKey' });

      statusPatches[key] = { status: newStat, inspector: newInsp, execChecked: newExec };
    }

    invalidateAllDataCache();
    await logAction('UPDATE STATUS', 'อัปเดตสถานะการตรวจ ' + updates.length + ' รายการ', userName);
    return { status: 'success', statusPatches };
  } catch (e) {
    return { status: 'error', message: String(e) };
  }
}

export async function updateCycleOffset(projectId: unknown, offset: unknown, userName: string) {
  try {
    if (projectId == null || String(projectId).trim() === '') {
      return { status: 'error', message: 'ไม่ได้ระบุรหัสโครงการ' };
    }
    let num = parseInt(String(offset));
    let safeOffset = isNaN(num) ? 0 : num;
    if (safeOffset > 1200) safeOffset = 1200;
    if (safeOffset < -1200) safeOffset = -1200;
    const supabase = getSupabase();
    await supabase.from('CycleOverrides').upsert({
      ProjectID: String(projectId),
      Offset: safeOffset,
      LastUpdate: new Date().toISOString(),
      UpdateBy: userName,
    }, { onConflict: 'ProjectID' });
    invalidateAllDataCache();
    await logAction('UPDATE CYCLE', 'ปรับแก้เลขงวด ID: ' + projectId, userName);
    return { status: 'success' };
  } catch (e) {
    return { status: 'error', message: String(e) };
  }
}

// ── Maintenance ────────────────────────────────────────────────

export async function updateMaintenanceVisit(data: Record<string, unknown>) {
  try {
    return updateMaintenanceVisitCore(
      data,
      'วันเข้าปฏิบัติงานนี้มีการบันทึกไว้แล้ว ไม่สามารถบันทึกซ้ำได้',
    );
  } catch (error) {
    return { status: 'error', message: String(error) };
  }
}

async function updateMaintenanceVisitCore(data: Record<string, unknown>, dupMsg?: string) {
  dupMsg = dupMsg || 'วันเข้าปฏิบัติงานนี้มีการบันทึกไว้แล้ว ไม่สามารถบันทึกซ้ำได้';
  if (!data || typeof data !== 'object') return { status: 'error', message: 'ข้อมูลว่าง' };
  if (!data.actualDate) return { status: 'error', message: 'กรุณาระบุวันที่เข้าปฏิบัติงานจริง' };
  const actualDateStart = data.actualDateStart != null ? String(data.actualDateStart).trim() : '';
  const startKey = normalizeActualDateKey(actualDateStart);
  const endKey = normalizeActualDateKey(data.actualDate);
  if (startKey && endKey && startKey > endKey) {
    return { status: 'error', message: 'วันสิ้นสุดต้องไม่ก่อนวันเริ่มต้น' };
  }
  let rowId = data.rowId != null ? String(data.rowId).trim() : '';
  const filesStr = typeof data.files === 'object' ? JSON.stringify(data.files || []) : (data.files || '[]');
  const targetIds = (data.targetProjectIds as unknown[] && (data.targetProjectIds as unknown[]).length)
    ? (data.targetProjectIds as unknown[]).map((id) => String(id || '').trim()).filter(Boolean)
    : [String(data.projectId || '').trim()].filter(Boolean);

  const supabase = getSupabase();

  if (!rowId) {
    const fallbackPid = String(data.projectId || targetIds[0] || '').trim();
    const fallbackVno = String(data.visitNo || '').trim();
    if (fallbackPid && fallbackVno) {
      const { data: findRes } = await supabase.from('Maintenance')
        .select('RowId').eq('ProjectID', fallbackPid).eq('VisitNo', fallbackVno);
      if (findRes && findRes.length > 0) {
        rowId = String(findRes[0].RowId || '').trim();
      }
    }
  }

  if (!rowId) {
    if (targetIds.length === 0) throw new Error('ไม่พบ ProjectID สำหรับบันทึกประวัติ');
    for (const pid of targetIds) {
      const { data: dupCheck } = await supabase.from('Maintenance')
        .select('RowId').eq('ProjectID', pid).eq('ActualDate', data.actualDate);
      if (dupCheck && dupCheck.length > 0) return { status: 'error', message: dupMsg };
    }
    const newRows = targetIds.map((pid, idx) => ({
      ProjectID: pid,
      VisitNo: data.visitNo,
      ScheduledDate: data.scheduledDate,
      ActualDate: data.actualDate,
      Remarks: data.remarks || '',
      RowId: 'M-' + shortId() + (idx > 0 ? '-' + idx : ''),
      Files: JSON.parse(filesStr as string),
      CycleMatched: data.cycleMatched || '',
      ActualDateStart: actualDateStart,
    }));
    await supabase.from('Maintenance').insert(newRows);
    await logAction(
      'บันทึกบำรุงรักษา',
      'เพิ่มรอบ ' + data.visitNo + ' จำนวน ' + targetIds.length + ' รายการ',
      data.userName as string,
    );
  } else {
    const { data: existing } = await supabase.from('Maintenance').select('*').eq('RowId', rowId);
    if (!existing || existing.length === 0) {
      if (targetIds.length === 0) return { status: 'error', message: 'ไม่พบ ProjectID สำหรับบันทึกประวัติ' };
      for (const pid of targetIds) {
        const { data: edupCheck } = await supabase.from('Maintenance')
          .select('RowId').eq('ProjectID', pid).eq('ActualDate', data.actualDate).neq('RowId', rowId);
        if (edupCheck && edupCheck.length > 0) return { status: 'error', message: dupMsg };
      }
      const insertRows = targetIds.map((pid, idx) => ({
        ProjectID: pid,
        VisitNo: data.visitNo,
        ScheduledDate: data.scheduledDate,
        ActualDate: data.actualDate,
        Remarks: data.remarks || '',
        RowId: rowId + (idx > 0 ? '-' + idx : ''),
        Files: JSON.parse(filesStr as string),
        CycleMatched: data.cycleMatched || '',
        ActualDateStart: actualDateStart,
      }));
      await supabase.from('Maintenance').insert(insertRows);
      await logAction(
        'บันทึกบำรุงรักษา',
        'เพิ่มรอบ ' + data.visitNo + ' จำนวน ' + targetIds.length + ' รายการ',
        data.userName as string,
      );
    } else {
      const editProjectId = String(existing[0].ProjectID || '').trim();
      const { data: dupCheck2 } = await supabase.from('Maintenance')
        .select('RowId').eq('ProjectID', editProjectId).eq('ActualDate', data.actualDate).neq('RowId', rowId);
      if (dupCheck2 && dupCheck2.length > 0) return { status: 'error', message: dupMsg };
      await supabase.from('Maintenance').update({
        VisitNo: data.visitNo,
        ScheduledDate: data.scheduledDate,
        ActualDate: data.actualDate,
        Remarks: data.remarks || '',
        Files: JSON.parse(filesStr as string),
        CycleMatched: data.cycleMatched || '',
        ActualDateStart: actualDateStart,
      }).eq('RowId', rowId);
      await logAction(
        'แก้ไขบำรุงรักษา',
        'อัปเดตรอบ ' + data.visitNo + ' โครงการ ' + data.projectId,
        data.userName as string,
      );
    }
  }
  invalidateAllDataCache();
  await logAuditRecord(
    data.userName as string,
    'MAINTENANCE',
    String(data.rowId || data.projectId || ''),
    data.rowId ? 'UPDATE' : 'CREATE',
    'visitNo=' + (data.visitNo || ''),
  );
  return { status: 'success' };
}

export async function deleteMaintenanceVisit(
  rowId: unknown,
  pId: unknown,
  visitNo: unknown,
  userName: string,
) {
  try {
    if (rowId == null || String(rowId).trim() === '') {
      return { status: 'error', message: 'ไม่ได้ระบุ RowId' };
    }
    const supabase = getSupabase();
    await supabase.from('Maintenance').delete().eq('RowId', String(rowId).trim());
    invalidateAllDataCache();
    await logAction('ลบประวัติบำรุงรักษา', 'ลบรอบที่ ' + visitNo + ' (รหัส: ' + pId + ')', userName);
    return { status: 'success' };
  } catch (error) {
    return { status: 'error', message: String(error) };
  }
}

// ── Maintenance Workflow ───────────────────────────────────────

async function findActiveMaintWorkflow(groupKey: unknown, visitNo: unknown) {
  const supabase = getSupabase();
  const { data } = await supabase.from('MaintWorkflow')
    .select('WorkflowID')
    .eq('GroupKey', String(groupKey))
    .eq('VisitNo', String(visitNo))
    .eq('Status', 'in_progress');
  return (data && data.length > 0) ? { WorkflowID: data[0].WorkflowID } : null;
}

function stepHasDataInRows(
  rows: Record<string, unknown>[],
  workflowId: unknown,
  stepNo: unknown,
): boolean {
  const wfId = String(workflowId);
  const sNo = Number(stepNo);
  for (const row of rows) {
    if (String(row.WorkflowID || row[0]) === wfId && Number(row.StepNo || row[1]) === sNo) {
      const note = String(row.Note || row[4] || '').trim();
      const letterNo = String(row.LetterNo || row[2] || '').trim();
      const stepDate = String(row.StepDate || row[3] || '').trim();
      if (note === 'ข้ามขั้นตอน') {
        if (letterNo && letterNo !== '-') return true;
        return !!stepDate;
      }
      if (letterNo && letterNo !== '-') return true;
      return !!stepDate;
    }
  }
  return false;
}

async function maintWorkflowStepHasData(workflowId: unknown, stepNo: unknown): Promise<boolean> {
  const steps = await getSheetDataAsObjects('MaintWorkflowSteps');
  return stepHasDataInRows(steps, workflowId, stepNo);
}

async function upsertMaintWorkflowStepWithData(
  workflowId: unknown,
  stepNo: unknown,
  letterNo: unknown,
  stepDate: unknown,
  note: unknown,
  userName: unknown,
) {
  const supabase = getSupabase();
  const now = new Date().toISOString();
  await supabase.from('MaintWorkflowSteps').upsert({
    WorkflowID: workflowId,
    StepNo: stepNo,
    LetterNo: letterNo || '',
    StepDate: stepDate || '',
    Note: note || '',
    UpdatedBy: userName || '',
    UpdatedAt: now,
  }, { onConflict: 'WorkflowID,StepNo' });
}

async function autoSkipMaintWorkflowSteps(
  workflowId: unknown,
  targetStep: number,
  userName: unknown,
) {
  if (targetStep <= 1) return;
  const steps = await getSheetDataAsObjects('MaintWorkflowSteps');
  for (let s = 1; s < targetStep; s++) {
    if (!stepHasDataInRows(steps, workflowId, s)) {
      await upsertMaintWorkflowStepWithData(workflowId, s, '-', '', 'ข้ามขั้นตอน', userName);
    }
  }
  const supabase = getSupabase();
  const { data: wfRes } = await supabase.from('MaintWorkflow')
    .select('CurrentStep').eq('WorkflowID', String(workflowId));
  if (wfRes && wfRes.length > 0) {
    const cur = parseInt(String(wfRes[0].CurrentStep), 10) || 1;
    if (targetStep > cur) {
      await supabase.from('MaintWorkflow').update({ CurrentStep: targetStep }).eq('WorkflowID', String(workflowId));
    }
  }
}

export async function startMaintWorkflow(data: Record<string, unknown>, userName: string) {
  try {
    const user = await getUserRecord(userName);
    if (!userCanEditMaintWorkflow(user, data && data.department)) {
      return { status: 'error', message: 'ไม่มีสิทธิ์' };
    }
    if (!data || !data.groupKey || !data.visitNo) return { status: 'error', message: 'ข้อมูลไม่ครบ' };
    if (await findActiveMaintWorkflow(data.groupKey, data.visitNo)) {
      return { status: 'error', message: 'มี workflow กำลังดำเนินการอยู่แล้วสำหรับรอบนี้' };
    }
    const wfId = 'WF-' + shortId();
    const now = new Date().toISOString();
    const supabase = getSupabase();
    await supabase.from('MaintWorkflow').insert({
      WorkflowID: wfId,
      GroupKey: data.groupKey,
      TargetProjectIds: ((data.targetProjectIds as unknown[]) || []).join(','),
      VisitNo: data.visitNo,
      Department: data.department || '',
      Status: 'in_progress',
      CurrentStep: 1,
      StartedAt: now,
      StartedBy: userName || '',
      MaintRowId: '',
      ScheduledDate: data.scheduledDate || '',
    });
    invalidateAllDataCache();
    await logAction('MAINT_WORKFLOW', 'เริ่ม workflow ' + wfId + ' รอบ ' + data.visitNo, userName);
    return { status: 'success', workflowId: wfId };
  } catch (e) {
    return { status: 'error', message: String(e) };
  }
}

export async function saveMaintWorkflowStep(data: Record<string, unknown>, userName: string) {
  try {
    const user = await getUserRecord(userName);
    if (!data || !data.workflowId || !data.stepNo) return { status: 'error', message: 'ข้อมูลไม่ครบ' };
    const supabase = getSupabase();
    const { data: wfRes } = await supabase.from('MaintWorkflow')
      .select('*').eq('WorkflowID', String(data.workflowId));
    if (!wfRes || wfRes.length === 0) return { status: 'error', message: 'ไม่พบ workflow' };
    const rowData = wfRes[0];
    const dept = String(rowData.Department || '');
    if (!userCanEditMaintWorkflow(user, dept)) return { status: 'error', message: 'ไม่มีสิทธิ์' };
    if (String(rowData.Status || '') !== 'in_progress') {
      return { status: 'error', message: 'workflow นี้ปิดแล้ว' };
    }
    const autoSkipTo = parseInt(String(data.autoSkipToStep), 10);
    if (!isNaN(autoSkipTo) && autoSkipTo >= 2 && autoSkipTo <= 5) {
      await autoSkipMaintWorkflowSteps(data.workflowId, autoSkipTo, userName);
    }
    const letterNo = String(data.letterNo || '').trim();
    const stepDate = String(data.stepDate || '').trim();
    if (!letterNo && !stepDate) {
      let nextStep = parseInt(String(data.nextStep), 10);
      if (!isNaN(autoSkipTo) && autoSkipTo >= 2 && autoSkipTo <= 5) {
        if (isNaN(nextStep) || nextStep < autoSkipTo) nextStep = autoSkipTo;
        return { status: 'success', workflowId: data.workflowId, autoSkipToStep: autoSkipTo, nextStep };
      }
      return { status: 'success', workflowId: data.workflowId, stepNo: data.stepNo, skipped: true };
    }
    await upsertMaintWorkflowStepWithData(data.workflowId, data.stepNo, letterNo, stepDate, '', userName);
    let nextStep2 = parseInt(String(data.nextStep), 10);
    if (!isNaN(nextStep2) && nextStep2 >= 1 && nextStep2 <= 5) {
      await supabase.from('MaintWorkflow').update({ CurrentStep: nextStep2 })
        .eq('WorkflowID', String(data.workflowId));
    } else if (!isNaN(autoSkipTo) && autoSkipTo >= 2 && autoSkipTo <= 5) {
      await autoSkipMaintWorkflowSteps(data.workflowId, autoSkipTo, userName);
    }
    invalidateAllDataCache();
    return {
      status: 'success',
      workflowId: data.workflowId,
      stepNo: data.stepNo,
      autoSkipToStep: autoSkipTo,
      nextStep: nextStep2,
    };
  } catch (e) {
    return { status: 'error', message: String(e) };
  }
}

export async function completeMaintWorkflow(data: Record<string, unknown>, userName: string) {
  try {
    const user = await getUserRecord(userName);
    if (!data || !data.workflowId) return { status: 'error', message: 'ข้อมูลไม่ครบ' };
    if (!data.actualDate) return { status: 'error', message: 'กรุณาระบุวันเข้าปฏิบัติงาน' };
    const supabase = getSupabase();
    const { data: wfRes } = await supabase.from('MaintWorkflow')
      .select('*').eq('WorkflowID', String(data.workflowId));
    if (!wfRes || wfRes.length === 0) return { status: 'error', message: 'ไม่พบ workflow' };
    const rowData = wfRes[0];
    const dept = String(rowData.Department || '');
    if (!userCanEditMaintWorkflow(user, dept)) return { status: 'error', message: 'ไม่มีสิทธิ์' };
    if (String(rowData.Status || '') !== 'in_progress') {
      return { status: 'error', message: 'workflow นี้ปิดแล้ว' };
    }
    if (!(await maintWorkflowStepHasData(data.workflowId, 4))) {
      return { status: 'error', message: 'กรุณาบันทึกขั้น 4 (บริษัท รายงานผลการล้างแผง) ก่อนปิดงาน' };
    }
    const steps = await getSheetDataAsObjects('MaintWorkflowSteps');
    let step3Date = '';
    for (const s of steps) {
      if (String(s.WorkflowID) === String(data.workflowId) && Number(s.StepNo) === 3) {
        step3Date = String(s.StepDate || '').trim();
        break;
      }
    }
    const washDate = (data.washDate || step3Date || '').toString().trim();
    if (washDate && washDate !== String(data.actualDate).trim()) {
      return { status: 'error', message: 'วันล้างแผง (ขั้น 3) ต้องตรงกับวันเข้าปฏิบัติงาน' };
    }
    await upsertMaintWorkflowStepWithData(data.workflowId, 5, data.letterNo || '', data.actualDate, '', userName);
    if (washDate) await upsertMaintWorkflowStepWithData(data.workflowId, 3, '', washDate, '', userName);
    const targetIds = String(rowData.TargetProjectIds || '').split(',').map((x) => x.trim()).filter(Boolean);
    const visitNo = rowData.VisitNo;
    const sched = (data.scheduledDate as string) || String(rowData.ScheduledDate || '') || '';
    const maintRes = await updateMaintenanceVisitCore({
      projectId: targetIds[0] || '',
      targetProjectIds: targetIds,
      visitNo,
      scheduledDate: sched,
      actualDate: data.actualDate,
      remarks: '',
      files: data.files || '[]',
      cycleMatched: data.cycleMatched || '',
      userName,
    });
    if (!maintRes || maintRes.status === 'error') {
      return maintRes || { status: 'error', message: 'บันทึก Maintenance ไม่สำเร็จ' };
    }
    const now = new Date().toISOString();
    await supabase.from('MaintWorkflow').update({
      Status: 'completed',
      CurrentStep: 5,
      CompletedAt: now,
      ScheduledDate: sched,
    }).eq('WorkflowID', String(data.workflowId));
    invalidateAllDataCache();
    await logAction('MAINT_WORKFLOW', 'จบ workflow ' + data.workflowId + ' รอบ ' + visitNo, userName);
    return { status: 'success' };
  } catch (e) {
    return { status: 'error', message: String(e) };
  }
}

export async function cancelMaintWorkflow(workflowId: unknown, userName: string) {
  try {
    const user = await getUserRecord(userName);
    const supabase = getSupabase();
    const { data: wfRes } = await supabase.from('MaintWorkflow')
      .select('Department, Status').eq('WorkflowID', String(workflowId));
    if (!wfRes || wfRes.length === 0) return { status: 'error', message: 'ไม่พบ workflow' };
    const dept = String(wfRes[0].Department || '');
    if (!userCanEditMaintWorkflow(user, dept)) return { status: 'error', message: 'ไม่มีสิทธิ์' };
    await supabase.from('MaintWorkflow').update({
      Status: 'cancelled',
      CompletedAt: new Date().toISOString(),
    }).eq('WorkflowID', String(workflowId));
    invalidateAllDataCache();
    await logAction('MAINT_WORKFLOW', 'ยกเลิก workflow ' + workflowId, userName);
    return { status: 'success' };
  } catch (e) {
    return { status: 'error', message: String(e) };
  }
}

// ── Dept Vault ─────────────────────────────────────────────────

export async function listDeptVault(userName: string) {
  try {
    const user = await getUserRecord(userName);
    if (!user) return { status: 'error', message: 'ไม่พบผู้ใช้ในระบบ — ลองออกจากระบบแล้วเข้าใหม่' };
    if (normalizeUserRole(user.role) === 'guest') return { status: 'error', message: 'กรุณาเข้าสู่ระบบ' };
    const items = await getDeptVaultRowsCached();
    const visible = items
      .filter((it) => userCanViewDeptVault(user, it.Department, it.IsPublic))
      .map(deptVaultSanitizeForClient);
    return { status: 'success', items: visible };
  } catch (e) {
    return { status: 'error', message: String(e && (e as Error).message ? (e as Error).message : e) };
  }
}

export async function saveDeptVaultItem(data: Record<string, unknown>, userName: string) {
  try {
    const user = await getUserRecord(userName);
    if (!user || user.role === 'guest') return { status: 'error', message: 'กรุณาเข้าสู่ระบบ' };
    if (!data) return { status: 'error', message: 'ไม่มีข้อมูล' };
    const dept = String(data.department || data.Department || '').trim();
    const title = String(data.title || data.Title || '').trim();
    const category = String(data.category || data.Category || 'note').trim().toLowerCase();
    const allowedCats = ['note', 'credential', 'link', 'contact'];
    if (!dept) return { status: 'error', message: 'กรุณาเลือกแผนก' };
    if (!title) return { status: 'error', message: 'กรุณาระบุหัวข้อ' };
    if (allowedCats.indexOf(category) < 0) return { status: 'error', message: 'หมวดหมู่ไม่ถูกต้อง' };
    const id = String(data.id || data.ID || '').trim();
    const isEdit = !!id;
    if (isEdit && !userCanEditDeptVault(user, dept)) {
      return { status: 'error', message: 'ไม่มีสิทธิ์แก้ไขรายการนี้' };
    }
    if (!isEdit && !userCanEditDeptVault(user, dept)) {
      return { status: 'error', message: 'ไม่มีสิทธิ์เพิ่มรายการในแผนกนี้' };
    }
    const now = new Date().toISOString();
    let passwordEnc = '';
    let existingRow: Record<string, unknown> | null = null;
    const supabase = getSupabase();
    if (isEdit) {
      const { data: existing } = await supabase.from('DeptVault')
        .select('PasswordEnc, Department, CreatedBy, CreatedAt').eq('ID', id);
      if (!existing || existing.length === 0) return { status: 'error', message: 'ไม่พบรายการ' };
      existingRow = existing[0];
      passwordEnc = (existingRow.PasswordEnc as string) || '';
      if (!userCanEditDeptVault(user, existingRow.Department)) {
        return { status: 'error', message: 'ไม่มีสิทธิ์แก้ไขรายการนี้' };
      }
    }
    const newPass = data.password != null ? String(data.password) : '';
    if (newPass) passwordEnc = vaultEncrypt(newPass);
    else if (data.clearPassword) passwordEnc = '';

    const objId = isEdit ? id : ('DV-' + shortId());
    const creator = isEdit ? (existingRow ? existingRow.CreatedBy : userName) : userName;
    const created = isEdit ? (existingRow ? existingRow.CreatedAt : now) : now;

    await supabase.from('DeptVault').upsert({
      ID: objId,
      Department: dept.substring(0, 100),
      Category: category,
      Title: title.substring(0, 200),
      Content: String(data.content || data.Content || '').substring(0, 5000),
      URL: String(data.url || data.URL || '').substring(0, 500),
      Username: String(data.username || data.Username || '').substring(0, 200),
      PasswordEnc: passwordEnc,
      ContactName: String(data.contactName || data.ContactName || '').substring(0, 200),
      ContactPhone: String(data.contactPhone || data.ContactPhone || '').substring(0, 50),
      ContactEmail: String(data.contactEmail || data.ContactEmail || '').substring(0, 200),
      Tags: String(data.tags || data.Tags || '').substring(0, 300),
      IsPublic: (data.isPublic === true || String(data.isPublic).toLowerCase() === 'true') ? 'true' : 'false',
      CreatedBy: creator,
      CreatedAt: created,
      UpdatedBy: userName,
      UpdatedAt: now,
    }, { onConflict: 'ID' });
    invalidateAllDataCache();
    await logAction('DEPT_VAULT', (isEdit ? 'แก้ไข' : 'เพิ่ม') + ': ' + title, userName);
    return { status: 'success', id: objId };
  } catch (e) {
    return { status: 'error', message: String(e) };
  }
}

export async function deleteDeptVaultItem(id: unknown, userName: string) {
  try {
    const user = await getUserRecord(userName);
    if (!user || user.role === 'guest') return { status: 'error', message: 'กรุณาเข้าสู่ระบบ' };
    if (!id) return { status: 'error', message: 'ไม่พบรายการ' };
    const supabase = getSupabase();
    const { data: existing } = await supabase.from('DeptVault').select('Department').eq('ID', String(id));
    if (!existing || existing.length === 0) return { status: 'error', message: 'ไม่พบรายการ' };
    if (!userCanEditDeptVault(user, existing[0].Department)) {
      return { status: 'error', message: 'ไม่มีสิทธิ์ลบรายการนี้' };
    }
    await supabase.from('DeptVault').delete().eq('ID', String(id));
    invalidateAllDataCache();
    await logAction('DEPT_VAULT', 'ลบ ID: ' + id, userName);
    return { status: 'success' };
  } catch (e) {
    return { status: 'error', message: String(e) };
  }
}

export async function revealDeptVaultPassword(id: unknown, userName: string) {
  try {
    const user = await getUserRecord(userName);
    if (!user || user.role === 'guest') return { status: 'error', message: 'กรุณาเข้าสู่ระบบ' };
    if (!id) return { status: 'error', message: 'ไม่พบรายการ' };
    const items = await getDeptVaultRowsCached();
    const item = items.find((it) => String(it.ID) === String(id));
    if (!item) return { status: 'error', message: 'ไม่พบรายการ' };
    if (!userCanViewDeptVault(user, item.Department, item.IsPublic)) {
      return { status: 'error', message: 'ไม่มีสิทธิ์เข้าถึง' };
    }
    if (!item.PasswordEnc) return { status: 'error', message: 'ไม่มีรหัสผ่าน' };
    await logAction('DEPT_VAULT_REVEAL', 'เปิดดูรหัส: ' + (item.Title || id), userName);
    return { status: 'success', password: vaultDecrypt(item.PasswordEnc) };
  } catch (e) {
    return { status: 'error', message: String(e) };
  }
}

// ── License ────────────────────────────────────────────────────

async function getProjectById(projectId: unknown) {
  const id = String(projectId || '').trim();
  if (!id) return null;
  const supabase = getSupabase();
  const { data } = await supabase.from('Projects').select('*').eq('ID', id);
  return (data && data.length > 0) ? data[0] : null;
}

async function getLicenseTypeById(typeId: unknown) {
  const id = String(typeId || '').trim();
  if (!id) return null;
  const supabase = getSupabase();
  const { data } = await supabase.from('LicenseTypes').select('*').eq('ID', id);
  return (data && data.length > 0) ? data[0] : null;
}

export async function saveLicenseType(data: Record<string, unknown>, userName: string) {
  try {
    await initSheets();
    const user = await getUserRecord(userName);
    if (!user || normalizeUserRole(user.role) !== 'admin') return { status: 'error', message: 'ไม่มีสิทธิ์' };
    if (!data) return { status: 'error', message: 'ไม่มีข้อมูล' };
    const name = String(data.name || data.Name || '').trim();
    if (!name) return { status: 'error', message: 'กรุณาระบุชื่อประเภท' };
    let alertDays = parseInt(String(data.alertDays != null ? data.alertDays : data.AlertDays), 10);
    if (isNaN(alertDays) || alertDays < 1) {
      return { status: 'error', message: 'กรุณาระบุจำนวนวันแจ้งเตือน (อย่างน้อย 1)' };
    }
    const isOther = data.isOther === true || String(data.isOther || data.IsOther).toLowerCase() === 'true';
    const sortOrder = parseInt(String(data.sortOrder != null ? data.sortOrder : data.SortOrder), 10) || 100;
    const id = String(data.id || data.ID || '').trim();
    const isEdit = !!id;
    const objId = isEdit ? id : ('LT-' + shortId());
    const supabase = getSupabase();
    await supabase.from('LicenseTypes').upsert({
      ID: objId,
      Name: name.substring(0, 120),
      AlertDays: alertDays,
      IsOther: isOther,
      SortOrder: sortOrder,
      Active: true,
    }, { onConflict: 'ID' });
    invalidateAllDataCache();
    await logAction('LICENSE_TYPE', (isEdit ? 'แก้ไข' : 'เพิ่ม') + ' ประเภทใบอนุญาต: ' + name, userName);
    return { status: 'success', id: objId };
  } catch (e) {
    return { status: 'error', message: String(e) };
  }
}

export async function deleteLicenseType(id: unknown, userName: string) {
  try {
    await initSheets();
    const user = await getUserRecord(userName);
    if (!user || normalizeUserRole(user.role) !== 'admin') return { status: 'error', message: 'ไม่มีสิทธิ์' };
    id = String(id || '').trim();
    if (!id) return { status: 'error', message: 'ไม่พบรายการ' };
    if (id === 'LT-OTHER') return { status: 'error', message: 'ไม่สามารถลบประเภท "อื่นๆ" ได้' };
    const licenses = await getSheetDataAsObjects('ProjectLicenses');
    const inUse = licenses.some((l) => String(l.LicenseTypeID || '').trim() === id);
    if (inUse) return { status: 'error', message: 'มีโครงการใช้ประเภทนี้อยู่ — ลบไม่ได้' };
    const supabase = getSupabase();
    await supabase.from('LicenseTypes').update({ Active: false }).eq('ID', id);
    invalidateAllDataCache();
    await logAction('LICENSE_TYPE', 'ปิดใช้งานประเภท: ' + id, userName);
    return { status: 'success' };
  } catch (e) {
    return { status: 'error', message: String(e) };
  }
}

export async function saveProjectLicense(data: Record<string, unknown>, userName: string) {
  try {
    await initSheets();
    const user = await getUserRecord(userName);
    if (!user || normalizeUserRole(user.role) === 'guest') {
      return { status: 'error', message: 'กรุณาเข้าสู่ระบบ' };
    }
    if (!data) return { status: 'error', message: 'ไม่มีข้อมูล' };
    const projectId = String(data.projectId || data.ProjectID || '').trim();
    const project = await getProjectById(projectId);
    if (!project) return { status: 'error', message: 'ไม่พบโครงการ' };
    if (!userCanEditProjectDept(user, project.Department)) {
      return { status: 'error', message: 'ไม่มีสิทธิ์แก้ไขแผนกนี้' };
    }
    const typeId = String(data.licenseTypeId || data.LicenseTypeID || '').trim();
    const licType = typeId ? await getLicenseTypeById(typeId) : null;
    if (!typeId || !licType) return { status: 'error', message: 'กรุณาเลือกประเภทใบอนุญาต' };
    const isOther = String(licType.IsOther).toLowerCase() === 'true' || licType.IsOther === true;
    let customName = String(data.customTypeName || data.CustomTypeName || '').trim();
    if (isOther && !customName) return { status: 'error', message: 'กรุณาระบุชื่อประเภท (อื่นๆ)' };
    if (!isOther) customName = '';
    const startDate = String(data.startDate || data.StartDate || '').trim();
    if (!startDate) return { status: 'error', message: 'กรุณาระบุวันเริ่ม' };
    let expiryDate = String(data.expiryDate || data.ExpiryDate || '').trim();
    if (!expiryDate) return { status: 'error', message: 'กรุณาระบุวันหมดอายุ' };
    const expParsed = parseDateOnly(expiryDate);
    if (!expParsed) return { status: 'error', message: 'วันหมดอายุไม่ถูกต้อง' };
    expiryDate = formatDateISO(expParsed);
    const durationYears = computeLicenseDurationYears(startDate, expiryDate);
    if (isNaN(durationYears) || durationYears <= 0) {
      return { status: 'error', message: 'วันหมดอายุต้องหลังวันเริ่ม' };
    }
    let alertOverride = data.alertDaysOverride != null ? data.alertDaysOverride : data.AlertDaysOverride;
    if (alertOverride === '' || alertOverride == null) alertOverride = '';
    else {
      alertOverride = parseInt(String(alertOverride), 10);
      if (isNaN(alertOverride as number) || (alertOverride as number) < 1) {
        return { status: 'error', message: 'วันแจ้งเตือนไม่ถูกต้อง' };
      }
    }
    const id = String(data.id || data.ID || '').trim();
    const isEdit = !!id;
    const objId = isEdit ? id : ('PL-' + shortId());
    const now = new Date().toISOString();
    const supabase = getSupabase();
    await supabase.from('ProjectLicenses').upsert({
      ID: objId,
      ProjectID: projectId,
      LicenseTypeID: typeId,
      CustomTypeName: customName.substring(0, 120),
      LicenseNo: String(data.licenseNo || data.LicenseNo || '').substring(0, 100),
      StartDate: startDate,
      DurationYears: durationYears,
      ExpiryDate: expiryDate,
      AlertDaysOverride: alertOverride,
      Notes: String(data.notes || data.Notes || '').substring(0, 500),
      UpdatedBy: userName,
      UpdatedAt: now,
    }, { onConflict: 'ID' });
    invalidateAllDataCache();
    await logAction('PROJECT_LICENSE', (isEdit ? 'แก้ไข' : 'เพิ่ม') + ' ใบอนุญาต ' + projectId, userName);
    await logAuditRecord(userName, 'PROJECT_LICENSE', objId, isEdit ? 'UPDATE' : 'CREATE', 'projectId=' + projectId);
    return { status: 'success', id: objId };
  } catch (e) {
    return { status: 'error', message: String(e) };
  }
}

export async function deleteProjectLicense(id: unknown, userName: string) {
  try {
    await initSheets();
    const user = await getUserRecord(userName);
    if (!user || normalizeUserRole(user.role) === 'guest') {
      return { status: 'error', message: 'กรุณาเข้าสู่ระบบ' };
    }
    id = String(id || '').trim();
    if (!id) return { status: 'error', message: 'ไม่พบรายการ' };
    const supabase = getSupabase();
    const { data: existing } = await supabase.from('ProjectLicenses').select('ProjectID').eq('ID', id);
    if (!existing || existing.length === 0) return { status: 'error', message: 'ไม่พบรายการ' };
    const project = await getProjectById(existing[0].ProjectID);
    if (!project || !userCanEditProjectDept(user, project.Department)) {
      return { status: 'error', message: 'ไม่มีสิทธิ์' };
    }
    await supabase.from('ProjectLicenses').delete().eq('ID', id);
    invalidateAllDataCache();
    await logAction('PROJECT_LICENSE', 'ลบใบอนุญาต ' + id, userName);
    return { status: 'success' };
  } catch (e) {
    return { status: 'error', message: String(e) };
  }
}

// ── File Upload (Supabase Storage) ─────────────────────────────

export async function uploadFileToDrive(
  base64Data: unknown,
  fileName: unknown,
  deptName: unknown,
  explicitMimeType?: unknown,
) {
  try {
    if (!base64Data) return { status: 'error', message: 'ไม่มีข้อมูลไฟล์' };
    const rawName = fileName ? String(fileName) : ('upload_' + Date.now());
    const safeName = rawName.replace(/[\/\\:*?"<>|]/g, '_').substring(0, 200);
    const dept = deptName ? String(deptName).replace(/[\/\\:*?"<>|]/g, '_').substring(0, 100) : 'general';

    let contentType = (explicitMimeType as string) || 'application/octet-stream';
    const dataSplit = String(base64Data).split(',');
    if (dataSplit.length > 1) {
      const m = dataSplit[0].match(/data:([a-zA-Z0-9\-+\/.]+);base64/);
      if (m && m[1]) contentType = m[1];
    }

    if (dataSplit[dataSplit.length - 1].length > 28 * 1024 * 1024) {
      return { status: 'error', message: 'ไฟล์ใหญ่เกินกำหนด (จำกัด ~20MB)' };
    }

    let bytes: Uint8Array;
    try {
      const binary = atob(dataSplit[dataSplit.length - 1]);
      bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    } catch (_e) {
      return { status: 'error', message: 'ไฟล์ฐาน 64 ไม่ถูกต้อง' };
    }

    const path = `${dept}/${Date.now()}_${safeName}`;
    const supabase = getSupabase();
    const { error } = await supabase.storage.from('pea-files').upload(path, bytes, {
      contentType,
      upsert: false,
    });
    if (error) return { status: 'error', message: error.message };

    const { data: urlData } = supabase.storage.from('pea-files').getPublicUrl(path);
    return { status: 'success', url: urlData.publicUrl };
  } catch (e) {
    return { status: 'error', message: String(e) };
  }
}

// ── System Status & Backup ─────────────────────────────────────

export async function getSystemStatus() {
  try {
    await initSheets();
    const url = envGet('SUPABASE_URL') || '';
    const projectRef = url.replace('https://', '').replace('.supabase.co', '');
    return {
      status: 'success',
      backend: 'Supabase (PostgreSQL)',
      serverMode: 'edge',
      mode: 'edge',
      database: 'Supabase ' + projectRef,
      dbPath: url,
      dbSizeBytes: 0,
      projectCount: await countTable('Projects'),
      userCount: await countTable('Users'),
      maintenanceCount: await countTable('Maintenance'),
      statusCount: await countTable('Statuses'),
      uploadDirBytes: 0,
      diskFreeBytes: 0,
      diskFree: 'Supabase Cloud',
      freeSpace: 'Supabase Cloud',
      version: 'Supabase Edge Functions',
      uptime: 'Serverless',
      uptimeSeconds: 0,
    };
  } catch (e) {
    return { status: 'error', message: String(e) };
  }
}

export function createDatabaseBackup() {
  return { status: 'error', message: 'ใช้ Supabase Dashboard backup' };
}

export function restoreDatabaseBackup() {
  return { status: 'error', message: 'ใช้ Supabase Dashboard backup' };
}

// ── Project Files (stub) ───────────────────────────────────────

export async function listProjectFiles(_query: unknown, userName: string) {
  try {
    await initSheets();
    const user = await getUserRecord(userName);
    if (!user || normalizeUserRole(user.role) === 'guest') {
      return { status: 'error', message: 'กรุณาเข้าสู่ระบบ' };
    }
    return { status: 'success', files: [] };
  } catch (e) {
    return { status: 'error', message: String(e) };
  }
}

export function deleteProjectFile(_fileId: unknown, _userName: unknown) {
  return { status: 'error', message: LOCALHOST_ONLY_MSG };
}

export function renameProjectFile(_fileId: unknown, _newName: unknown, _userName: unknown) {
  return { status: 'error', message: LOCALHOST_ONLY_MSG };
}

export function moveProjectFile(_data: unknown, _userName: unknown) {
  return { status: 'error', message: LOCALHOST_ONLY_MSG };
}

export function createCustomFolder(_projectId: unknown, _name: unknown, _userName: unknown) {
  return { status: 'error', message: LOCALHOST_ONLY_MSG };
}

export async function listCustomFolders(_projectId: unknown, userName: string) {
  try {
    await initSheets();
    const user = await getUserRecord(userName);
    if (!user || normalizeUserRole(user.role) === 'guest') {
      return { status: 'error', message: 'กรุณาเข้าสู่ระบบ' };
    }
    return { status: 'success', folders: [] };
  } catch (e) {
    return { status: 'error', message: String(e) };
  }
}

export function deleteCustomFolder(_folderId: unknown, _userName: unknown) {
  return { status: 'error', message: LOCALHOST_ONLY_MSG };
}

export { getAllData };
