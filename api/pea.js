import { handleHttpRequest } from './pea.mjs';

export default async function handler(req, res) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const url = proto + '://' + host + (req.url || '/api/pea');
  let body;
  if (req.method === 'POST') {
    body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
  }
  const response = await handleHttpRequest(new Request(url, { method: req.method, headers: req.headers, body }));
  const text = await response.text();
  res.status(response.status);
  response.headers.forEach((v, k) => { if (k !== 'content-encoding') res.setHeader(k, v); });
  res.end(text);
}
