import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/AuthProvider'
import { useVenue } from '@/features/venues/VenueProvider'
import { useToast } from '@/components/ui/Toast'
import { supabase } from '@/lib/supabase/client'
import { Field, Input, FormActions } from '@/components/forms/Fields'

const profileSchema = z.object({
  full_name:    z.string().min(1, 'Full name is required').max(120),
  display_name: z.string().max(60).optional(),
  phone:        z.string().max(30).optional(),
})

type ProfileFormValues = z.infer<typeof profileSchema>

export function ProfilePage() {
  const { profile, refreshProfile, signOut } = useAuth()
  const { activeVenue, activeRole } = useVenue()
  const toast = useToast()

  const { register, handleSubmit, formState: { errors, isSubmitting, isDirty } } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      full_name:    profile?.full_name ?? '',
      display_name: profile?.display_name ?? '',
      phone:        profile?.phone ?? '',
    },
  })

  const saveMutation = useMutation({
    mutationFn: async (values: ProfileFormValues) => {
      const { error } = await supabase.from('profiles').update({
        full_name:    values.full_name,
        display_name: values.display_name || null,
        phone:        values.phone || null,
      }).eq('id', profile?.id ?? '')
      if (error) throw error
    },
    onSuccess: () => { refreshProfile(); toast.success('Profile updated.') },
    onError: (err: Error) => toast.error(err.message),
  })

  return (
    <div className="max-w-md space-y-6">
      <h1 className="text-xl font-bold text-slate-100">Profile</h1>

      {/* Current venue info */}
      {activeVenue && (
        <div className="bg-surface-1 border border-surface-2 rounded-2xl px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Active venue</p>
            <p className="text-sm text-slate-200 font-medium mt-0.5">{activeVenue.name}</p>
          </div>
          <span className="text-xs text-slate-400 capitalize bg-surface-2 px-2 py-1 rounded-lg">
            {activeRole?.replace('_', ' ')}
          </span>
        </div>
      )}

      {/* Edit form */}
      <form onSubmit={handleSubmit(v => saveMutation.mutate(v))} noValidate className="space-y-4">
        <Field label="Full name" error={errors.full_name?.message} required>
          <Input {...register('full_name')} error={!!errors.full_name} placeholder="Your full name" />
        </Field>
        <Field label="Display name" hint="Shown in events and activity logs. Shorter than full name.">
          <Input {...register('display_name')} placeholder="e.g. Alex" />
        </Field>
        <Field label="Phone">
          <Input {...register('phone')} type="tel" inputMode="tel" placeholder="+1 604 555 0100" />
        </Field>

        {isDirty && (
          <FormActions
            onCancel={() => {}}
            isSubmitting={isSubmitting || saveMutation.isPending}
            submitLabel="Save Changes"
          />
        )}
      </form>

      {/* Sign out */}
      <div className="pt-4 border-t border-surface-2">
        <button
          onClick={signOut}
          className="w-full py-2.5 px-4 rounded-xl text-sm font-medium text-danger bg-danger/5 hover:bg-danger/10 border border-danger/20 transition-colors"
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
