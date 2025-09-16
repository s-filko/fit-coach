# Test Plan (MVP)

This plan enumerates tests to run before each commit. We add tests first, then implement.

## Security (X-Api-Key)
- Public:
  - GET /health → 200 without header
- Protected (applies to all /api/*):
  - no header → 401
  - invalid key → 403
  - valid key → 200

## Users
- POST /api/user with valid key and minimal body → 200, returns id
- GET /api/user/{id} with valid key:
  - existing → 200, id matches
  - non-existing → 404

## Chat (stub)
- S-0008: POST /api/chat with valid key → 200, returns `{ data: { content: string, timestamp: string } }`.
- S-0011: POST /api/chat for unknown user → 404 with `{ error: { message: 'User not found' } }`.

## Notes
- Server should not be started externally; tests use Fastify inject.
- When DB is introduced, add integration tests with seeded data.
