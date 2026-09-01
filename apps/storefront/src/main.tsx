import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@/lib/auth'
import { queryClient } from '@/lib/query-client'
import { router } from '@/routes'
import { Toaster } from '@/components/ui/sonner'
import '@/styles/globals.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root is missing from index.html')

createRoot(root).render(
  <StrictMode>
    {/* QueryClientProvider wraps AuthProvider: logout clears the cache, so the
        next person on this browser cannot see the last one's orders. */}
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
