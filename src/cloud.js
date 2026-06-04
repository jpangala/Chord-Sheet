// ─── Supabase cloud-save integration ──────────────────────────
//
// SETUP CHECKLIST (one-time):
//
//   1. Create a free Supabase project at https://supabase.com
//   2. In the SQL editor, run:
//
//        create table public.songs (
//          id          text primary key,
//          owner_id    text not null,
//          title       text not null,
//          artist      text default '',
//          key         text default 'C',
//          bpm         integer default 120,
//          time_sig    text default '4/4',
//          sections    jsonb default '[]',
//          created_at  timestamptz default now(),
//          updated_at  timestamptz default now()
//        );
//        alter table public.songs enable row level security;
//        create policy "device-owned read"   on public.songs for select
//          using (owner_id = current_setting('request.headers', true)::json->>'x-device-id');
//        create policy "device-owned write"  on public.songs for insert
//          with check (owner_id = current_setting('request.headers', true)::json->>'x-device-id');
//        create policy "device-owned update" on public.songs for update
//          using  (owner_id = current_setting('request.headers', true)::json->>'x-device-id')
//          with check (owner_id = current_setting('request.headers', true)::json->>'x-device-id');
//        create policy "device-owned delete" on public.songs for delete
//          using (owner_id = current_setting('request.headers', true)::json->>'x-device-id');
//
//   3. Copy your project URL and anon public key into a .env file at the repo root:
//
//        VITE_SUPABASE_URL=https://<project>.supabase.co
//        VITE_SUPABASE_ANON_KEY=<anon-public-key>
//
//   4. Restart `npm run dev`. The Save-to-cloud button appears once both env
//      vars are present.
//
// Without the env vars, the app continues to work in localStorage-only mode.

import { createClient } from '@supabase/supabase-js';

const URL  = import.meta.env.VITE_SUPABASE_URL;
const KEY  = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Stable device identifier for anonymous ownership. Lost if browser storage
// is wiped — by design (no signup, no recovery).
const DEVICE_KEY = 'chordsheet_device_id';
function ensureDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = (crypto.randomUUID && crypto.randomUUID()) ||
           `dev_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

const deviceId = URL && KEY ? ensureDeviceId() : null;

// Singleton — null when env vars are missing.
const client = (URL && KEY && deviceId)
  ? createClient(URL, KEY, {
      global: { headers: { 'x-device-id': deviceId } },
      auth: { persistSession: false },
    })
  : null;

export function isCloudEnabled() {
  return !!client;
}

export function getDeviceId() {
  return deviceId;
}

function toRow(song) {
  return {
    id: song.id,
    owner_id: deviceId,
    title: song.title || '',
    artist: song.artist || '',
    key: song.key || 'C',
    bpm: song.bpm ?? 120,
    time_sig: song.timeSig || '4/4',
    sections: song.sections || [],
    updated_at: new Date(song.updatedAt || Date.now()).toISOString(),
  };
}

function fromRow(row) {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist || '',
    key: row.key || 'C',
    bpm: row.bpm ?? 120,
    timeSig: row.time_sig || '4/4',
    sections: row.sections || [],
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
  };
}

/** Upserts a song. Returns { ok, error }. */
export async function cloudSaveSong(song) {
  if (!client) return { ok: false, error: 'cloud not enabled' };
  const { error } = await client.from('songs').upsert(toRow(song), { onConflict: 'id' });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Fetches every song this device owns. Returns { ok, songs?, error? }. */
export async function cloudFetchSongs() {
  if (!client) return { ok: false, error: 'cloud not enabled' };
  const { data, error } = await client.from('songs').select('*').eq('owner_id', deviceId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, songs: (data || []).map(fromRow) };
}

/** Deletes a song by id. Returns { ok, error }. */
export async function cloudDeleteSong(id) {
  if (!client) return { ok: false, error: 'cloud not enabled' };
  const { error } = await client.from('songs').delete().eq('id', id);
  return error ? { ok: false, error: error.message } : { ok: true };
}
