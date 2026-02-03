# Path-Based Request Policies

## The Problem

Asking agents for "reasons" is security theater:

```yaml
stripe:
  service: stripe
  requiresReason: true  # Agent can say anything
```

Agent says "Checking balance" → actually charges a card. Reasons are just text. Agents can generate convincing lies.

---

## The Solution: Enforcement

**Path-based allow/deny rules:**

```yaml
stripe_readonly:
  service: stripe
  rules:
    allow:
      - GET *
    deny:
      - POST *
      - PUT *
      - DELETE *
```

Now the agent **cannot** charge cards, delete customers, or modify anything — regardless of what reason it provides. Server-side enforcement. No escape.

---

## How It Works

### 1. Define Rules

```yaml
capabilities:
  stripe_readonly:
    service: stripe
    rules:
      allow:
        - GET *
      deny:
        - POST *
        - DELETE *

  stripe_billing:
    service: stripe
    rules:
      allow:
        - GET *
        - POST /v1/refunds/*
        - POST /v1/invoices/*
      deny:
        - POST /v1/charges/*  # Can't charge cards
```

### 2. Agent Makes Request

```typescript
janee_execute({
  service: "stripe_readonly",
  method: "POST",
  path: "/v1/charges",
  reason: "User asked me to charge their card"
})
```

### 3. Janee Checks Rules

1. Check deny patterns: `POST *` matches → **DENIED**
2. Return 403 Forbidden
3. Request never reaches Stripe
4. Log the denial

### 4. Audit Trail

```json
{
  "timestamp": "2026-02-03T09:30:00Z",
  "capability": "stripe_readonly",
  "method": "POST",
  "path": "/v1/charges",
  "denied": true,
  "denyReason": "Denied by rule: POST *",
  "reason": "User asked me to charge their card"
}
```

Agent provided a reason. Rules denied it anyway.

---

## Pattern Syntax

**Format:** `METHOD PATH`

| Pattern | Matches | Doesn't Match |
|---------|---------|---------------|
| `GET *` | Any GET request | POST, PUT, DELETE |
| `POST /v1/charges/*` | POST /v1/charges/ch_123 | GET /v1/charges/ch_123 |
| `* /v1/balance` | Any method to /v1/balance | Other paths |
| `DELETE *` | Any DELETE request | GET, POST, PUT |

---

## Rule Evaluation

```
1. No rules defined? → ALLOW (backward compatible)
2. Check DENY patterns → if match, DENY (deny always wins)
3. Check ALLOW patterns → if match, ALLOW
4. No match? → DENY (default deny when rules exist)
```

**Key: DENY always beats ALLOW**

---

## Examples

### Read-Only Stripe

```yaml
stripe_readonly:
  service: stripe
  rules:
    allow:
      - GET *
    deny:
      - POST *
      - PUT *
      - DELETE *
```

**Can:** View customers, balances, invoices  
**Cannot:** Create, update, or delete anything

### Billing Operations Only

```yaml
stripe_billing:
  service: stripe
  rules:
    allow:
      - GET *
      - POST /v1/refunds/*
      - POST /v1/invoices/*
    deny:
      - POST /v1/charges/*
      - DELETE *
```

**Can:** Issue refunds, create invoices  
**Cannot:** Charge cards, delete records

### Exchange Trading (Restricted)

```yaml
exchange_readonly:
  service: bybit
  rules:
    allow:
      - GET *
    deny:
      - POST *

exchange_trading:
  service: bybit
  rules:
    allow:
      - GET *
      - POST /v5/order/create
      - POST /v5/order/cancel
    deny:
      - POST /v5/order/amend
```

**readonly:** Check balances only  
**trading:** Place and cancel orders (can't modify existing)

---

## Best Practices

### Start Restrictive

```yaml
rules:
  allow:
    - GET *
  deny:
    - POST *
    - PUT *
    - DELETE *
```

### Use Separate Capabilities

```yaml
# Good: separate capabilities with different permissions
stripe_readonly:
  rules:
    allow: [GET *]

stripe_billing:
  rules:
    allow: [GET *, POST /v1/refunds/*]

# Bad: one capability for everything
stripe:
  rules:
    allow: [* *]  # Too permissive
```

### Combine with Audit

```yaml
stripe_billing:
  requiresReason: true  # For audit trail
  rules:
    allow:
      - POST /v1/refunds/*
    deny:
      - POST /v1/charges/*
```

Reason logged for review, but rules enforce the boundary.

---

## Backward Compatibility

No rules = allow all (existing configs work unchanged):

```yaml
stripe:
  service: stripe
  ttl: 1h
  # No rules defined = all requests allowed
```

---

## Security Model

**Defense in depth:**

1. **Encryption** — Keys encrypted at rest
2. **Isolation** — Agent never sees real keys
3. **Policies** — Rules enforce allowed operations ← this
4. **Audit** — All requests logged
5. **TTL** — Time limits on capabilities

Policies limit blast radius even if an agent session is compromised.
