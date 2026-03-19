## ADDED Requirements

### Requirement: Skill import generates minimal AAI descriptors
AAI Gateway SHALL provide an `aai-gateway ...` CLI import flow for skills that generates a minimal AAI descriptor containing:
- `app`
- `access`
- `exposure`

#### Scenario: Import a local skill
- **WHEN** a user imports a local skill directory
- **THEN** the gateway generates a descriptor and stores the integration in the local registry

#### Scenario: Import a remote skill root
- **WHEN** a user imports a remote skill root URL
- **THEN** the gateway generates a descriptor and stores the integration in the local registry

### Requirement: Imported skills are stored in a gateway-managed directory
The gateway SHALL copy or download imported skills as full skill directories into a gateway-managed local directory rather than depending on the original path or remote URL at execution time alone.

#### Scenario: Imported skill is normalized into gateway storage
- **WHEN** a skill import succeeds
- **THEN** the gateway stores the skill artifact in its managed local directory and records the generated descriptor against that managed asset

### Requirement: Skill import collects exposure metadata
The skill import flow SHALL ensure that the generated descriptor contains `exposure.keywords` and `exposure.summary`.

The gateway SHOULD support:
- direct CLI collection from the user
- optional agent-assisted generation from the imported skill content

#### Scenario: User confirms generated skill exposure metadata
- **WHEN** the import flow derives `keywords` and `summary` from a skill document
- **THEN** the user can review or override those values before the descriptor is stored
