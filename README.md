# O-M_Billing — PEA NEXUS Frontend (GitHub Pages)

Frontend สำหรับระบบบำรุงรักษาและติดตามค่าจัดการพลังงาน

## URL

- **Frontend:** https://pongvitsam.github.io/O-M_Billing/
- **Backend API:** Google Apps Script (Supabase)

## โครงสร้าง

```
docs/
  index.html      ← หน้าแอป (build จาก PEA_NEXUS)
  js/
    config.js     ← ตั้งค่า GAS_URL
    gas-bridge.js ← polyfill google.script.run ผ่าน fetch
```

## Build ใหม่ (จากโปรเจกต GAS)

```bash
cd PEA_NEXUS
node scripts/build-pages.mjs
# copy docs/ → O-M_Billing/docs/ แล้ว git push
```

## GitHub Pages

Settings → Pages → Source: **Deploy from branch** → Branch: `main` → Folder: **`/docs`**
