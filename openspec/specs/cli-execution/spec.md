## ADDED Requirements

### Requirement: CLI-backed apps are supported as a protocol family
AAI Gateway SHALL support `access.protocol: "cli"` as a first-class protocol family.

#### Scenario: Descriptor declares CLI access
- **WHEN** a descriptor declares `access.protocol: "cli"`
- **THEN** the gateway treats the app as CLI-backed

### Requirement: CLI config is command-based
For `access.protocol: "cli"`, the descriptor SHALL define runtime config using:
- `command`
- optional `args`
- optional `env`
- optional `cwd`

#### Scenario: CLI-backed app is configured
- **WHEN** a descriptor provides CLI command config
- **THEN** the gateway can launch the command using that config

### Requirement: CLI detail loading is gateway-managed
For CLI-backed apps, the gateway SHALL manage layer-3 detail loading outside the AAI descriptor.

#### Scenario: CLI details are requested
- **WHEN** the agent requests detailed capability information for a CLI-backed app
- **THEN** the gateway loads that detail using its CLI integration logic rather than from descriptor-embedded tool schemas
