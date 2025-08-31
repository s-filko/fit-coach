# Fit Coach API Spec (MVP)

This spec is the canonical definition of the MVP API. Code must match this document.

Base URL: `/`

## Security
- Protected routes: all under `/api/*` require header `X-Api-Key: <secret>`.
- Public routes: `/health`, `/docs`, `/docs/*`.
- Error codes:
  - 401 Unauthorized — header `X-Api-Key` отсутствует
  - 403 Forbidden — ключ передан, но неверный

Swagger (OpenAPI) additions:
```yaml
components:
  securitySchemes:
    ApiKeyAuth:
      type: apiKey
      in: header
      name: X-Api-Key
```
Protected endpoints should declare:
```yaml
security:
  - ApiKeyAuth: []
```

## 1. Health
- GET `/health`
- Response 200: `{ "status": "ok" }`

## 2. Users

### 2.1 Create/Upsert User
- POST `/api/user`
- Request body (Zod):
```ts
{
  provider: string(min:1),
  providerUserId: string(min:1),
  username?: string,
  firstName?: string,
  lastName?: string,
  languageCode?: string,
}
```
- Responses:
  - 200 `{ data: { id: string } }`
  - 400 `{ error: { message: string } }`
  - 401 `{ error: { message: string } }`
  - 403 `{ error: { message: string } }`

### 2.2 Get User by Id
- GET `/api/user/{id}`
- Path params: `{ id: string }`
- Responses:
  - 200 `{ data: { id: string } }`
  - 401 `{ error: { message: string } }`
  - 403 `{ error: { message: string } }`
  - 404 `{ error: { message: "User not found" } }`

## 3. Message (Stub)

### 3.1 Process Message
- POST `/api/message`
- Request body (Zod):
```ts
{
  userId: string(min:1),
  message: string(min:1),
}
```
- Responses:
  - 200 `{ data: { echo: string } }`
  - 401 `{ error: { message: string } }`
  - 403 `{ error: { message: string } }`

## Notes
- All responses are JSON.
- Errors follow `{ error: { message, code? } }`.
- On future DB integration, user payloads may expand; this spec will be updated first.
