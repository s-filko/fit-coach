Domain: <DomainName>

Terms
	• <Term>: <single-line definition>

Invariants
	• INV-<DOMAIN>-001: <testable, single-line>

Business Rules
	• BR-<DOMAIN>-001: <testable, single-line>

Ports
	• <IServiceName> (<TOKEN_NAME>)
	• <methodName>(input): output [BR-<DOMAIN>-###]

Rules:
- One file per domain (≤ 50 lines).
- Must match apps/server/src/domain/<domain>/ports/*.ts.
- English only; reference BR/INV by ID.

