## ADDED Requirements

### Requirement: ACP prompt updates are surfaced incrementally
For ACP-backed apps, the gateway SHALL treat `session/update` notifications as incremental execution output and surface them through the active northbound `streamable-http` execution channel before the terminal prompt result is returned.

#### Scenario: ACP prompt emits incremental updates
- **WHEN** an ACP prompt produces one or more `session/update` notifications before the final response
- **THEN** the gateway forwards those updates incrementally to the active client-facing execution stream

### Requirement: ACP sessions are isolated per connected gateway client
For ACP-backed apps, the gateway SHALL scope ACP session reuse to the connected gateway client context rather than sharing one ACP session across all clients of the same app.

#### Scenario: Different clients do not share an ACP session
- **WHEN** two different AI tools prompt the same ACP-backed app through one gateway instance
- **THEN** the gateway creates or uses separate ACP sessions for each connected client context

#### Scenario: The same client can reuse its ACP session
- **WHEN** the same AI tool sends multiple prompts to the same ACP-backed app through one gateway client context
- **THEN** the gateway may reuse that client's existing ACP session for continuity
