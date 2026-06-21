import { dispatchApiCall } from '../_shared/dispatch.ts';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: CORS_HEADERS });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ status: 'error', message: 'Method not allowed' }, 405);
  }

  try {
    const body = await req.json();
    const fn = String(body.fn || body.method || '').trim();
    let args = body.args;
    if (!Array.isArray(args)) args = args != null ? [args] : [];

    if (!fn) {
      return jsonResponse({ status: 'error', message: 'Missing fn/method' });
    }

    const result = await dispatchApiCall(fn, args);
    return jsonResponse(result);
  } catch (err) {
    return jsonResponse({ status: 'error', message: String(err) });
  }
});
