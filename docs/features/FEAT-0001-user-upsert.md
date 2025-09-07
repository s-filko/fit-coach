FEAT-0001 User Upsert

User Story

As a client app, I want to upsert a user by provider identity so that I can obtain a stable user id for subsequent operations.

Scenarios
	• S-0001: Given a user does not exist, When upsert is called, Then a new user id is returned [BR-USER-001]
	• S-0002: Given a user exists for (provider, providerUserId), When upsert is called, Then the existing user id is returned [BR-USER-001]
	• S-0003: Given missing API key, When upsert is called, Then 401 is returned
	• S-0004: Given invalid API key, When upsert is called, Then 403 is returned

Acceptance Criteria
	• AC-0001: 200 { data: { id: string } }
	• AC-0002: 401/403 error envelope { error: { message } }

API Mapping
	• POST /api/user → IUserService.upsertUser

Domain Rules Reference
	• BR-USER-001, BR-USER-004 from /docs/domain/user.spec.md
