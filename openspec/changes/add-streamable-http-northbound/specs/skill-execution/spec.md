## ADDED Requirements

### Requirement: Skill guidance exposes the gateway-managed base path
For skill-backed apps stored by AAI Gateway, the gateway SHALL include the gateway-managed skill base path in the guidance returned to upstream AI tools.

#### Scenario: Imported skill guidance is requested
- **WHEN** an AI tool requests guidance or detail for a skill-backed app managed by the gateway
- **THEN** the returned guidance includes the base path under which AAI Gateway stores managed skills

### Requirement: Skill guidance reflects gateway-owned storage rather than client defaults
AAI Gateway SHALL describe skill locations using the gateway-managed storage path instead of assuming the upstream AI tool's default skill directory.

#### Scenario: Upstream AI tool uses a different default skill directory
- **WHEN** the gateway returns guidance for a skill-backed app to an AI tool whose own default skill directory differs from the gateway's managed storage
- **THEN** the guidance still points to the gateway-managed path that actually contains the skill files
