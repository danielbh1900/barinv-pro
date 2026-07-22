ALTER TABLE public.staff
  ADD COLUMN auth_user_id uuid
    REFERENCES auth.users(id)
    ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS staff_auth_user_id_uniq
  ON public.staff(auth_user_id)
  WHERE auth_user_id IS NOT NULL;;
