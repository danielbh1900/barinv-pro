import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { RouterProvider } from 'react-router-dom'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { VenueProvider } from '@/features/venues/VenueProvider'
import { ToastProvider } from '@/components/ui/Toast'
import { SyncProvider } from '@/features/auth/SyncProvider'
import { router } from '@/app/router'
import { env } from '@/lib/utils/env'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      retry: (failureCount, error) => {
        if (error instanceof Error && error.message.includes('401')) return false
        return failureCount < 2
      },
    },
    mutations: {
      retry: 0,
    },
  },
})

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <SyncProvider>
            <VenueProvider>
              <RouterProvider router={router} />
            </VenueProvider>
          </SyncProvider>
        </AuthProvider>
      </ToastProvider>
      {env.isDev && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  )
}
