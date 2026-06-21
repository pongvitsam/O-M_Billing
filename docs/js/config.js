/** PEA NEXUS — GitHub Pages config (Supabase backend) */
window.PEA_NEXUS_CONFIG = {
  SUPABASE_URL: 'https://nnsxyuhiwgrqbszrhyiz.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_qMqdfCN5EcUiBh1zNcBVBQ_G-qmeQx5',
  /** Production API (Cloudflare Workers) */
  API_URL: 'https://pea-nexus-api.surf-alloy-4b8.workers.dev',
  /** Fallback: Supabase Edge Function */
  API_URL_SUPABASE: 'https://nnsxyuhiwgrqbszrhyiz.supabase.co/functions/v1/api',
  /** Fallback: Vercel */
  API_URL_VERCEL: 'https://o-m-billing.vercel.app/api/pea',
  GITHUB_PAGES_URL: 'https://pongvitsam.github.io/O-M_Billing/'
};
