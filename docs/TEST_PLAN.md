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

## Message (stub)
- POST /api/message with valid key → 200, echo field equals message

## Notes
- Server should not be started externally; tests use Fastify inject.
- When DB is introduced, add integration tests with seeded data.
