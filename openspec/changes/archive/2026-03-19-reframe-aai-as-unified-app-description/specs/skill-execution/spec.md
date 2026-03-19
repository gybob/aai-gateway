## ADDED Requirements

### Requirement: Skill-backed apps are supported as a protocol family
AAI Gateway SHALL support `access.protocol: "skill"` as a first-class protocol family.

#### Scenario: Descriptor declares skill access
- **WHEN** a descriptor declares `access.protocol: "skill"`
- **THEN** the gateway treats the app as skill-backed

### Requirement: Skill config supports local and remote skill roots
For `access.protocol: "skill"`, the descriptor SHALL support exactly one of:
- local skill-directory `path`
- remote skill-root `url`

#### Scenario: Local skill directory is configured
- **WHEN** a skill descriptor specifies `config.path`
- **THEN** the gateway loads layer-3 detail from the skill directory rooted at that path

#### Scenario: Remote skill root is configured
- **WHEN** a skill descriptor specifies `config.url`
- **THEN** the gateway loads layer-3 detail from that remote skill root

### Requirement: Skill execution uses the unified resolver
When executing a skill-backed app, the gateway SHALL dispatch through the unified resolver into the skill executor.

#### Scenario: Skill-backed app executes through common routing
- **WHEN** a client calls `aai:exec` for a skill-backed app
- **THEN** the gateway dispatches execution through the skill executor
