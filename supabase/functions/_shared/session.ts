import { getSupabase } from './context.ts';
import { getUserRecord, normalizeUserRole } from './helpers.ts';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSIONS_KEY = 'USER_SESSIONS';

type SessionMap = Record<string, { username: string; expires: number }>;

function generateToken(): string {
  return crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
}

async function readSessions(): Promise<SessionMap> {
  const supabase = getSupabase();
  const { data } = await supabase.from('Settings').select('Value').eq('Key', SESSIONS_KEY).maybeSingle();
  if (!data?.Value) return {};
  try {
    return JSON.parse(String(data.Value)) as SessionMap;
  } catch {
    return {};
  }
}

async function writeSessions(map: SessionMap): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from('Settings').upsert(
    { Key: SESSIONS_KEY, Value: JSON.stringify(map || {}) },
    { onConflict: 'Key' },
  );
  if (error) throw error;
}

function pruneSessions(sessions: SessionMap): SessionMap {
  const now = Date.now();
  const out: SessionMap = {};
  for (const k of Object.keys(sessions || {})) {
    const s = sessions[k];
    if (s && s.expires && s.expires >= now) out[k] = s;
  }
  return out;
}

export async function createSession(username: string): Promise<string> {
  const token = generateToken();
  const sessions = pruneSessions(await readSessions());
  sessions[token] = { username: String(username), expires: Date.now() + SESSION_TTL_MS };
  await writeSessions(sessions);
  return token;
}

export async function restoreSession(
  username: string,
  token: string,
): Promise<Record<string, unknown>> {
  try {
    if (!username || !token) return { status: 'error', message: 'ไม่พบ session' };

    const sessions = pruneSessions(await readSessions());
    await writeSessions(sessions);
    const sess = sessions[String(token)];
    if (!sess) return { status: 'error', message: 'session หมดอายุ' };
    if (String(sess.username).trim().toLowerCase() !== String(username).trim().toLowerCase()) {
      return { status: 'error', message: 'session ไม่ถูกต้อง' };
    }

    const user = await getUserRecord(username);
    if (!user) return { status: 'error', message: 'ไม่พบผู้ใช้' };

    return {
      status: 'success',
      username: user.username,
      role: normalizeUserRole(user.role),
      depts: user.depts,
      token: String(token),
    };
  } catch (e) {
    return { status: 'error', message: String(e) };
  }
}

export async function invalidateSession(token: string): Promise<{ status: string }> {
  if (token) {
    const sessions = await readSessions();
    delete sessions[String(token)];
    await writeSessions(sessions);
  }
  return { status: 'success' };
}
