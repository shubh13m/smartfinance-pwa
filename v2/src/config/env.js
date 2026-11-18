// The Supabase URL and anon key are public by design: access is enforced by
// row-level security (see db/001_init.sql). Never put a service_role key here.
// Leave both empty to run in local mode (data stays in this browser).
export const SUPABASE = {
  url: 'https://dqqmcijfzghorpjmytpa.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxcW1jaWpmemdob3Jwam15dHBhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ5NDMzNjMsImV4cCI6MjExMDUxOTM2M30.Eejj9YzzG3YuvcUqHwUDk2AFzBcuYbGcQBo9xuZugGk',
};

export const LOCAL_MODE_KEY = 'sf2_mode';

// Cloud mode when configured, unless this browser is pinned to local mode
// (localStorage sf2_mode = 'local'). The automated browser tests use that pin so they
// never touch the real database.
export function isCloudMode(config = SUPABASE, storage = globalThis.localStorage) {
  if (!config.url || !config.anonKey) return false;
  try {
    return storage?.getItem(LOCAL_MODE_KEY) !== 'local';
  } catch {
    return true;
  }
}
