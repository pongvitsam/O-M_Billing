# O-M_Billing — PEA NEXUS (GitHub Pages + Supabase)

- **Frontend:** https://pongvitsam.github.io/O-M_Billing/
- **API:** Supabase Edge Function `/functions/v1/api`
- **Database:** Supabase PostgreSQL

## Build frontend

```bash
cd PEA_NEXUS
node scripts/build-pages.mjs
# copy docs/ → O-M_Billing/docs/ → git push
```

## Deploy API (Supabase CLI)

```bash
cd PEA_NEXUS
supabase login
supabase functions deploy api --project-ref nnsxyuhiwgrqbszrhyiz --no-verify-jwt
supabase functions deploy heartbeat --project-ref nnsxyuhiwgrqbszrhyiz --no-verify-jwt
```

Set Edge Function secrets: `SUPABASE_SERVICE_ROLE_KEY`, `VAULT_SECRET`

## GitHub Pages

Settings → Pages → Branch `main`, Folder `/docs`
