-- UserSessions (ถ้ายังไม่มี)
CREATE TABLE IF NOT EXISTS "UserSessions" (
  "Token"     TEXT PRIMARY KEY,
  "Username"  TEXT NOT NULL,
  "ExpiresAt" TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usersessions_expires ON "UserSessions" ("ExpiresAt");

ALTER TABLE "UserSessions" ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "anon_full_access" ON "UserSessions" FOR ALL TO anon USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Storage bucket สำหรับไฟล์แนบ
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('pea-files', 'pea-files', true, 20971520)
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = 20971520;

-- อนุญาตอ่านไฟล์สาธารณะ
DO $$ BEGIN
  CREATE POLICY "pea_files_public_read" ON storage.objects
    FOR SELECT TO public USING (bucket_id = 'pea-files');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Service role / authenticated upload (Edge Function ใช้ service role)
DO $$ BEGIN
  CREATE POLICY "pea_files_service_insert" ON storage.objects
    FOR INSERT TO authenticated WITH CHECK (bucket_id = 'pea-files');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
