/* barinv-public-config.js — PUBLIC, browser-safe Supabase config.
 *
 * Loaded by barback.html and barback_manager.html on the GitHub Pages
 * deploy so a barback's personal phone (never opened the BARINV admin
 * app, has nothing in localStorage) can still call barback-login.
 *
 * SECURITY RULES — read before editing:
 *   • Only the Supabase project URL + the browser-safe anon
 *     (publishable) key belong here. Both are public by design;
 *     row-level security plus the signed barback session token
 *     enforce all access.
 *   • NEVER add the service_role key, an `sb_secret_*` key, the
 *     database password, or the JWT secret to this file. This file
 *     is served publicly from https://danielbh1900.github.io/barinv-pro/.
 *   • Rotate the anon key via the Supabase dashboard if it leaks
 *     beyond intent, then re-deploy.
 */
window.BARINV_PUBLIC_SUPABASE_CONFIG = {
  url:     "https://uzommuafouvaerdvirzf.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV6b21tdWFmb3V2YWVyZHZpcnpmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5NDc4NjEsImV4cCI6MjA4OTUyMzg2MX0.pE6NTm6s8hMUdQ2ciTT6MkxDd67YfzKy5Y6VXHd_qfE"
};
