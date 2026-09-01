import { createBrowserRouter } from 'react-router'
import { AdminLayout } from '@/layouts/AdminLayout'
import { RedirectIfAuthenticated, RequireRole } from '@/components/require-role'
import LoginPage from './login'
import ForgotPasswordPage from './forgot-password'
import ResetPasswordPage from './reset-password'
import ForbiddenPage from './forbidden'
import NotFoundPage from './not-found'
import DashboardPage from './dashboard'
import BrandsPage from './brands'
import CategoriesPage from './categories'
import AttributesPage from './attributes'
import AttributeDetailPage from './attributes/attribute-detail'
import VariantOptionsPage from './variant-options'
import VariantOptionDetailPage from './variant-options/variant-option-detail'
import ProductsPage from './products'
import ProductEditorPage, { NewProductPage } from './products/product-editor'
import InventoryPage from './inventory'
import LowStockPage from './inventory/low-stock'
import InventoryTransactionsPage from './inventory/transactions'
import InventoryVariantPage from './inventory/variant-detail'
import CollectionsPage from './collections'
import CollectionEditorPage, { NewCollectionPage } from './collections/collection-editor'
import OrdersPage from './orders'
import OrderDetailPage from './orders/order-detail'
import PaymentsPage from './payments'
import PaymentDetailPage from './payments/payment-detail'
import CustomersPage from './customers'
import CustomerDetailPage from './customers/customer-detail'

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
          { path: 'brands', element: <BrandsPage /> },
          { path: 'categories', element: <CategoriesPage /> },
          { path: 'attributes', element: <AttributesPage /> },
          { path: 'attributes/:id', element: <AttributeDetailPage /> },
          { path: 'variant-options', element: <VariantOptionsPage /> },
          { path: 'variant-options/:id', element: <VariantOptionDetailPage /> },
          { path: 'products', element: <ProductsPage /> },
          // Before ':id', or 'new' is read as a product id and the editor
          // fetches a uuid that does not exist.
          { path: 'products/new', element: <NewProductPage /> },
          { path: 'products/:id', element: <ProductEditorPage /> },
          { path: 'inventory', element: <InventoryPage /> },
          // Before ':variantId', or these are read as ids and the uuid schema
          // rejects them with a 400.
          { path: 'inventory/low-stock', element: <LowStockPage /> },
          { path: 'inventory/transactions', element: <InventoryTransactionsPage /> },
          { path: 'inventory/:variantId', element: <InventoryVariantPage /> },
          { path: 'collections', element: <CollectionsPage /> },
          // Before ':id', or 'new' is read as a collection id.
          { path: 'collections/new', element: <NewCollectionPage /> },
          { path: 'collections/:id', element: <CollectionEditorPage /> },
          // Read-heavy: orders are created by the payment webhook, and the only
          // write here is the status transition.
          { path: 'orders', element: <OrdersPage /> },
          { path: 'orders/:id', element: <OrderDetailPage /> },
          { path: 'payments', element: <PaymentsPage /> },
          { path: 'payments/:id', element: <PaymentDetailPage /> },
          // Support: read-heavy, two writes, neither of which can act as the
          // customer.
          { path: 'customers', element: <CustomersPage /> },
          { path: 'customers/:id', element: <CustomerDetailPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
])
