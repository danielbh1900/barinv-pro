ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS photo_url text;

COMMENT ON COLUMN public.staff.photo_url IS
  'Public URL of the uploaded staff avatar (stored in Supabase Storage bucket "staff-avatars"). NULL = initials fallback.';;
