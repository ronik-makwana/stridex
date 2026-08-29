import { createBrowserRouter } from 'react-router'
import { AdminLayout } from '@/layouts/AdminLayout'
import { RedirectIfAuthenticated, RequireRole } from '@/components/require-role'
import LoginPage from './login'
import ForgotPasswordPage from './forgot-password'
import ResetPasswordPage from './reset-password'
import ForbiddenPage from './forbidden'
import NotFoundPage from './not-found'
import DashboardPage from './dashboard'

export const router = createBrowserRouter([
  {
    element: <RedirectIfAuthenticated />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
      { path: '/reset-password', element: <ResetPasswordPage /> },
    ],
  },
  { path: '/403', element: <ForbiddenPage /> },
  {
    // Every admin screen sits under one guard. STAFF and ADMIN both pass here;
    // ADMIN-only areas (settings, admin users) nest a second RequireRole.
    element: <RequireRole roles={['ADMIN', 'STAFF']} />,
    children: [
      {
        element: <AdminLayout />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
])
