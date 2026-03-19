## ADDED Requirements

### Requirement: AAI is a minimal exposure descriptor
AAI SHALL define a minimal descriptor composed of:
- `app`
- `access`
- `exposure`

AAI SHALL NOT define centralized tool schemas, embedded execution routing fields, or user policy fields.

#### Scenario: Descriptor uses a non-AAI protocol family
- **WHEN** a descriptor declares `access.protocol` as `mcp`, `skill`, `acp-agent`, or `cli`
- **THEN** it remains a valid AAI descriptor

### Requirement: The app object is display-only
The `app` object SHALL contain only display metadata needed for listing and authorization, including:
- localized `name`
- a required default name fallback
- optional `iconUrl`

#### Scenario: Authorization prompt uses app display metadata
- **WHEN** the gateway asks the user to authorize access to an app
- **THEN** it identifies the app using `app.name` and optional `app.iconUrl`

### Requirement: Access identifies the integration family
The descriptor SHALL use `access` to identify:
- which protocol family the gateway should use
- the minimal protocol-specific configuration needed to connect

#### Scenario: Gateway resolves runtime behavior from access
- **WHEN** the gateway loads a descriptor
- **THEN** it determines the protocol family and runtime integration from `access`

### Requirement: Exposure defines only the first two layers
The `exposure` object SHALL contain only:
- `keywords`
- `summary`

The descriptor SHALL NOT embed layer-3 detailed capability metadata.

#### Scenario: Detailed capabilities are deferred
- **WHEN** the gateway exposes an app during baseline discovery
- **THEN** it exposes only `keywords` and `summary`

### Requirement: Discovery works across packaging forms
AAI Gateway SHALL support discovering descriptors from:
- desktop app fixed or app-specific scanned locations
- a gateway-managed local directory for CLI-installed descriptors
- fixed web well-known URLs

#### Scenario: Gateway discovers a web app descriptor
- **WHEN** a user targets a website and the gateway checks its well-known descriptor URL
- **THEN** the gateway can load the descriptor and expose that app through the same layered flow

#### Scenario: Gateway discovers a sandboxed desktop app descriptor
- **WHEN** a sandboxed desktop app publishes its descriptor in an app-owned location that the gateway knows how to scan
- **THEN** the gateway can load the descriptor without requiring that app to write into the gateway-managed directory
