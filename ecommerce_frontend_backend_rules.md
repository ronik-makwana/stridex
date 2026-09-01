# E-Commerce Frontend & Backend Rules

## Core Principle

> Frontend improves UX; backend is the final authority for price, inventory, order state, payment, and security.

---

## 1. Inventory Reservation

When a user starts checkout:

1. Validate product/variant exists.
2. Validate product is active.
3. Validate current price.
4. Check inventory.
5. Create a temporary inventory reservation.
6. Reserve inventory with a TTL, for example 10 minutes.

### Reservation

```text
reservation
------------
id
user_id
variant_id
quantity
expires_at
status
```

Possible statuses:

```text
ACTIVE
RELEASED
EXPIRED
CONSUMED
```

### Important

Never trust quantity or price sent by the frontend.

Frontend should send:

```json
{
  "variantId": "v123",
  "quantity": 2
}
```

Backend calculates and validates the rest.

---

## 2. Checkout Expiry

Checkout sessions should expire.

```text
Checkout Created
       ↓
10-minute timer
       ↓
Payment not completed
       ↓
Checkout EXPIRED
       ↓
Release inventory
```

Example:

```text
checkout_session
----------------
id
user_id
status
expires_at
reservation_id
```

Possible states:

```text
ACTIVE
PAYMENT_PENDING
COMPLETED
EXPIRED
CANCELLED
```

### Important

The frontend timer is only for UX.

The backend must enforce:

```text
if now > expires_at:
    reject checkout/payment
```

---

## 3. Inventory Race Conditions

Example:

```text
Stock = 1

User A → Buy
User B → Buy
```

Only one user should successfully reserve the item.

Use an atomic database operation or appropriate transaction/locking.

Conceptually:

```sql
UPDATE inventory
SET available = available - 1
WHERE variant_id = ?
AND available >= 1;
```

Then:

```text
affected rows = 1 → reservation successful
affected rows = 0 → out of stock
```

Avoid:

```text
SELECT available
↓
available = 1
↓
UPDATE later
```

without concurrency protection.

---

## 4. Cart vs Inventory

Adding an item to cart should generally NOT reserve inventory.

Recommended:

```text
Add to Cart
    ↓
No Reservation

Checkout
    ↓
Reserve Inventory
    ↓
Payment
```

Otherwise users can block inventory simply by filling their carts.

---

## 5. Price Validation

Never trust frontend price.

Frontend:

```json
{
  "variantId": "v1",
  "quantity": 2
}
```

Backend:

```text
DB price = ₹1,299
quantity = 2

subtotal = ₹2,598
```

If frontend sends:

```json
{
  "price": 999
}
```

the backend should ignore it.

---

## 6. Price Changes During Checkout

A product price can change while a user is checking out.

A good approach is to snapshot the price when checkout is created:

```text
checkout_item
-------------
variant_id
unit_price
quantity
```

Payment uses the checkout price snapshot.

If checkout expires, the user creates a new checkout and gets the latest price.

---

## 7. Duplicate Payment Handling

This is one of the most important rules.

Scenario:

```text
User clicks Pay
      ↓
Network becomes slow
      ↓
User clicks Pay again
```

The backend must prevent duplicate payments.

Use an idempotency key.

Frontend:

```text
idempotencyKey = UUID()
```

Request:

```http
POST /payments
Idempotency-Key: <uuid>
```

Backend stores:

```text
payment_attempt
---------------
id
idempotency_key UNIQUE
order_id
status
provider_payment_id
response
```

If the same idempotency key is received again:

```text
Return the previous result
```

Do not create another payment.

---

## 8. Payment Webhook as Source of Truth

Do not rely only on frontend payment success.

Bad flow:

```text
Frontend
   ↓
Payment Success
   ↓
Order Confirmed
```

Better:

```text
Frontend
   ↓
Payment Provider
   ↓
Webhook
   ↓
Backend
   ↓
Verify Webhook
   ↓
Update Payment
   ↓
Confirm Order
```

The frontend should query the backend for the final order status.

---

## 9. Payment Timeout

If the payment provider doesn't immediately respond:

```text
PAYMENT_PENDING
```

Do not immediately mark it failed.

Later:

```text
Webhook → SUCCESS
```

or:

```text
Reconciliation → FAILED
```

If payment ultimately fails, release the inventory reservation.

---

## 10. Payment Succeeded but Frontend Didn't Receive Response

Example:

```text
User pays ₹2,000
       ↓
Payment succeeds
       ↓
Network disconnects
       ↓
Frontend shows "Payment failed"
```

If the user clicks Pay again, duplicate payment could occur.

Frontend should first check:

```http
GET /orders/{orderId}
```

or:

```http
GET /payments/{paymentId}
```

Backend may return:

```json
{
  "paymentStatus": "SUCCESS",
  "orderStatus": "CONFIRMED"
}
```

Frontend then shows the confirmation page.

---

## 11. Order State Machine

Do not allow arbitrary order status changes.

Recommended:

```text
CREATED
   ↓
PAYMENT_PENDING
   ↓
CONFIRMED
   ↓
PROCESSING
   ↓
SHIPPED
   ↓
DELIVERED
```

Cancellation depends on business rules:

```text
CREATED → CANCELLED
CONFIRMED → CANCELLED
```

But avoid invalid transitions such as:

```text
DELIVERED → PAYMENT_PENDING
```

---

## 12. Frontend Should Not Decide Order Status

Bad:

```javascript
if (paymentSuccess) {
    setOrderStatus("confirmed");
}
```

Instead:

```text
Frontend
   ↓
GET /orders/:id
   ↓
Backend
   ↓
CONFIRMED
```

The frontend displays the backend state.

---

## 13. Prevent Double Clicks

Frontend should disable the payment button:

```text
Pay
 ↓
Loading...
 ↓
Disable button
```

But this is only UX protection.

Backend still requires:

```text
Idempotency
+
Database constraints
+
Transactions
```

---

## 14. Transactional Order Creation

When confirming an order, related database operations should be protected.

Conceptually:

```text
BEGIN TRANSACTION

Create order
Create order_items
Update inventory
Create payment record

COMMIT
```

If something fails:

```text
ROLLBACK
```

Avoid inconsistent states such as:

```text
Payment = SUCCESS
Order = missing
```

A reconciliation mechanism should exist for distributed payment flows.

---

## 15. Database Unique Constraints

Important identifiers should be protected at database level.

Examples:

```text
payment.provider_payment_id UNIQUE
payment.idempotency_key UNIQUE
order.order_number UNIQUE
reservation.id UNIQUE
```

Application-level validation alone is not enough.

---

## 16. Cart Validation at Checkout

A cart can become stale.

Example:

```text
User adds product
       ↓
Price changes
       ↓
Stock becomes 0
       ↓
Product becomes inactive
```

At checkout, backend must revalidate:

```text
Product status
Price
Inventory
Quantity
Coupon
Tax
Shipping
```

Example response:

```json
{
  "errors": [
    {
      "variantId": "v1",
      "reason": "OUT_OF_STOCK"
    },
    {
      "variantId": "v2",
      "reason": "PRICE_CHANGED"
    }
  ]
}
```

Frontend asks the user to review the cart.

---

## 17. Quantity Validation

Frontend can restrict the UI:

```text
Quantity: 1–10
```

Backend must still validate:

```text
quantity >= 1
quantity <= max_allowed_quantity
quantity <= available_inventory
```

Never depend on frontend validation.

---

## 18. Product Deletion

Avoid hard-deleting products that exist in historical orders.

Instead:

```text
product.status = ARCHIVED
```

Order items should store snapshots:

```text
order_item
----------
product_id
variant_id
product_title_snapshot
variant_name_snapshot
unit_price
quantity
```

This ensures old orders remain correct even if the product changes later.

---

## 19. Order Price Snapshots

An order should store the actual price paid.

```text
order_item
----------
product_id
variant_id
product_title_snapshot
variant_name_snapshot
unit_price
quantity
discount
tax
```

Do not calculate historical order totals using the current product price.

---

## 20. Coupon Validation

Frontend can display:

```text
Coupon applied
```

But backend must validate:

```text
Coupon exists
Coupon active
Start date
End date
Usage limit
User usage limit
Minimum cart value
Eligible products
Eligible categories
```

Discount calculation must happen on the backend.

---

## 21. Tax and Shipping Calculation

Frontend should not be trusted for:

```text
tax
shipping
discount
subtotal
total
```

Frontend can display the calculation.

Backend should calculate the final amount.

---

## 22. Authentication and Authorization

Sensitive APIs must verify:

```text
Authentication
      ↓
Authorization
      ↓
Resource Ownership
```

Example:

```http
GET /orders/123
```

Backend must verify:

```text
Does order 123 belong to this authenticated user?
```

Never rely on frontend hiding another user's data.

---

## 23. Checkout Ownership

A checkout session belongs to a user.

```text
checkout.user_id = authenticatedUser.id
```

If another user tries to access it:

```text
403 Forbidden
```

---

## 24. Expired Reservation Cleanup

Do not rely only on a scheduled job.

When a reservation is accessed:

```text
if expires_at < now:
    status = EXPIRED
    release inventory
```

A background worker/cron can additionally clean up expired reservations.

---

## 25. Multiple Browser Tabs

Scenario:

```text
Tab A → Checkout
Tab B → Checkout
```

Tab A completes payment:

```text
Order = CONFIRMED
Reservation = CONSUMED
```

Tab B should not be allowed to pay again.

Backend should return something like:

```text
CHECKOUT_ALREADY_COMPLETED
```

Frontend redirects to the order confirmation page.

---

## 26. Refresh Safety

A user may refresh the payment page.

Refreshing must not create another payment.

Use:

```text
GET /checkout/:id
GET /payment/:id
GET /orders/:id
```

to restore state.

A good checkout flow should be refresh-safe.

---

## 27. Browser Back Button

Do not assume browser navigation means cancellation.

Example:

```text
Checkout
   ↓
Payment
   ↓
Back
```

Backend state remains authoritative.

If payment is already successful:

```text
payment = SUCCESS
```

going back should not create another payment.

---

# Recommended Complete Checkout Flow

```text
                    PRODUCT
                       │
                       ↓
                     CART
                       │
                       ↓
              Validate Cart
          ┌────────────┼────────────┐
          ↓            ↓            ↓
       Price        Inventory     Coupon
          │            │            │
          └────────────┼────────────┘
                       ↓
                CREATE CHECKOUT
                       │
                       ↓
              RESERVE INVENTORY
                   TTL 10 min
                       │
                       ↓
                CREATE PAYMENT
               Idempotency-Key
                       │
                       ↓
                PAYMENT PROVIDER
                  /           \
                 /             \
             SUCCESS          FAILED
                │                │
                ↓                ↓
             WEBHOOK           RELEASE
                │               STOCK
                ↓
          VERIFY WEBHOOK
                │
                ↓
          CONFIRM ORDER
                │
                ↓
        FINALIZE INVENTORY
                │
                ↓
         ORDER CONFIRMED
```

# SDE-2 Must-Know Rules

| Area | Rule |
|---|---|
| Inventory | Backend authoritative |
| Reservation | Temporary TTL |
| Checkout | Expirable |
| Price | Backend calculated |
| Cart | Revalidated at checkout |
| Payment | Idempotency key |
| Payment success | Verified webhook |
| Order | State machine |
| Inventory | Atomic/transactional update |
| Duplicate request | Idempotent |
| Double click | Frontend protection + backend idempotency |
| Coupon | Backend validation |
| Tax | Backend calculation |
| Shipping | Backend calculation |
| Order history | Snapshot product/price data |
| Product deletion | Archive instead of hard delete |
| Authentication | Backend verification |
| Authorization | Backend verification |
| Refresh | Must be safe |
| Multiple tabs | Backend state wins |
| Expiry | Backend enforced |
| Payment timeout | `PAYMENT_PENDING` + reconciliation |
| Database | Unique constraints |
