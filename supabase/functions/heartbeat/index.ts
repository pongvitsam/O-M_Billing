import { getSupabase } from '../_shared/context.ts';

const HEARTBEAT_ACTION = 'SYSTEM_HEARTBEAT';
const HEARTBEAT_USER = '__SYSTEM__';
const HEARTBEAT_INTERVAL_DAYS = 5;

async function supabaseKeepAlive(): Promise<void> {
  const supabase = getSupabase();
  const now = new Date().toISOString();

  const { data: insertData, error: insertError } = await supabase
    .from('Logs')
    .insert({
      Timestamp: now,
      User: HEARTBEAT_USER,
      Action: HEARTBEAT_ACTION,
      Detail: 'Keep-alive heartbeat — ป้องกัน Supabase pause',
    })
    .select('id');

  if (insertError) {
    console.error('[Heartbeat] Insert failed:', JSON.stringify(insertError));
    return;
  }

  const insertedId = Array.isArray(insertData) && insertData.length > 0
    ? insertData[0].id
    : null;

  if (insertedId != null) {
    await supabase.from('Logs').delete().eq('id', insertedId);
  }

  const cutoff = new Date(Date.now() - (HEARTBEAT_INTERVAL_DAYS + 2) * 86400000).toISOString();
  await supabase.from('Logs').delete()
    .eq('Action', HEARTBEAT_ACTION)
    .lt('Timestamp', cutoff);

  await supabase.from('Settings').upsert(
    { Key: 'LastHeartbeat', Value: now },
    { onConflict: 'Key' },
  );

  console.log('[Heartbeat] Done @ ' + now);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      },
    });
  }

  try {
    await supabaseKeepAlive();
    return new Response(
      JSON.stringify({
        status: 'success',
        message: 'Heartbeat ทำงานสำเร็จ — ตรวจสอบ Logs และ Settings.LastHeartbeat',
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ status: 'error', message: 'Heartbeat ล้มเหลว: ' + String(e) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
});
