FEAT-0002 Get User

User Story

As a client app, I want to fetch a user by id so that I can display the user’s basic profile.

Scenarios
	• S-0005: Given user exists, When GET by id, Then 200 with { id } is returned [BR-USER-002]
	• S-0006: Given user does not exist, When GET by id, Then 404 is returned [BR-USER-002]
	• S-0007: Given missing/invalid API key, When GET by id, Then 401/403 is returned

Acceptance Criteria
	• AC-0003: 200 { data: { id: string } }
	• AC-0004: 404 error { error: { message: "User not found" } }

API Mapping
	• GET /api/user/:id → IUserService.getUser

Domain Rules Reference
	• BR-USER-002 from /docs/domain/user.spec.md
