# Supabase

**Project ref:** `awgcorggtvfcnmjdcljb`
**Project URL:** `https://awgcorggtvfcnmjdcljb.supabase.co`
**Dashboard:** https://supabase.com/dashboard/project/awgcorggtvfcnmjdcljb

## Schema

```sql
CREATE TABLE public.profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name  TEXT NOT NULL,
  color         TEXT NOT NULL DEFAULT '#7c5cfc',
  tier          TEXT NOT NULL DEFAULT 'free',
  stripe_customer_id TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.vaults (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name        TEXT NOT NULL,
  invite_code TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(6), 'hex'),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.vault_members (
  vault_id  UUID REFERENCES public.vaults(id) ON DELETE CASCADE,
  user_id   UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  status    TEXT NOT NULL DEFAULT 'active',
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (vault_id, user_id)
);

CREATE TABLE public.vault_docs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_id   UUID REFERENCES public.vaults(id) ON DELETE CASCADE,
  file_path  TEXT NOT NULL,
  yjs_state  BYTEA,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (vault_id, file_path)
);
```

## Triggers

```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  palette TEXT[] := ARRAY['#f472b6','#60a5fa','#4ade80','#fb923c','#a78bfa','#f59e0b','#34d399'];
  user_count INT;
BEGIN
  SELECT COUNT(*) INTO user_count FROM public.profiles;
  INSERT INTO public.profiles (id, display_name, color)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    palette[(user_count % 7) + 1]
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

## RLS Policies

Enable RLS on all 4 tables: `ALTER TABLE public.<name> ENABLE ROW LEVEL SECURITY;`

### profiles
```sql
-- Anyone authenticated can read all profiles
CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT TO authenticated USING (true);

-- Users can only update/insert their own profile
CREATE POLICY "profiles_insert" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_update" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id);
```

### vaults
```sql
-- Owners have full access
CREATE POLICY "vaults_owner_all" ON public.vaults
  FOR ALL TO authenticated USING (auth.uid() = owner_id);

-- Active members can read
CREATE POLICY "vaults_member_select" ON public.vaults
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.vault_members
      WHERE vault_id = id AND user_id = auth.uid() AND status = 'active'
    )
  );
```

### vault_members
```sql
-- Vault owner can manage all membership rows
CREATE POLICY "vault_members_owner_all" ON public.vault_members
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.vaults
      WHERE id = vault_id AND owner_id = auth.uid()
    )
  );

-- Users can see their own membership rows
CREATE POLICY "vault_members_self_select" ON public.vault_members
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Users can insert themselves (join via invite code, validated at API layer)
CREATE POLICY "vault_members_self_insert" ON public.vault_members
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
```

### vault_docs
```sql
-- Active members of the vault can read and write docs
CREATE POLICY "vault_docs_member_all" ON public.vault_docs
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.vault_members
      WHERE vault_id = vault_docs.vault_id AND user_id = auth.uid() AND status = 'active'
    )
  );
```

## Auth Config
- Email auth: enabled
- JWT expiry: 3600s
- Confirm email: disabled for Phase 1 (enable in Phase 4)

## Key Variables (get from Supabase dashboard)
- `SUPABASE_URL`: `https://awgcorggtvfcnmjdcljb.supabase.co`
- `SUPABASE_ANON_KEY`: Settings → API → anon key (safe for clients)
- `SUPABASE_SERVICE_ROLE_KEY`: Settings → API → service_role key (server-only, never expose)

## Status
- [ ] Schema created (Backend Engineer — Phase 1a)
- [ ] RLS enabled on all 4 tables (Backend Engineer — Phase 1a)
- [ ] Trigger created and tested (Backend Engineer — Phase 1a)
