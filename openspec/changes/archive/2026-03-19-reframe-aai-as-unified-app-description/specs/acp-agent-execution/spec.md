## ADDED Requirements

### Requirement: ACP agents are supported as a protocol family
AAI Gateway SHALL support `access.protocol: "acp-agent"` as a first-class protocol family.

#### Scenario: Descriptor declares ACP access
- **WHEN** a descriptor declares `access.protocol: "acp-agent"`
- **THEN** the gateway treats the app as ACP-backed

### Requirement: ACP agent config is command-based
For `access.protocol: "acp-agent"`, the descriptor SHALL define ACP launch config using:
- `command`
- optional `args`
- optional `env`
- optional `cwd`

The gateway SHALL interpret this config as launching an ACP endpoint over stdio.

#### Scenario: Native ACP agent is configured
- **WHEN** the descriptor points to a native ACP agent command
- **THEN** the gateway launches it and communicates using ACP over stdio

#### Scenario: ACP adapter is configured
- **WHEN** the descriptor points to an ACP adapter command
- **THEN** the gateway launches it and communicates using ACP over stdio

### Requirement: ACP detail loading uses ACP-native flow
For ACP-backed apps, the gateway SHALL derive layer-3 detail from ACP-native initialization and session metadata rather than from AAI-owned capability schemas.

#### Scenario: ACP details are loaded on demand
- **WHEN** the agent requests detailed capability information for an ACP-backed app
- **THEN** the gateway derives that detail from ACP-native interaction

### Requirement: ACP execution is routed through the unified resolver
When executing an ACP-backed app, the gateway SHALL use the unified protocol resolver and dispatch to the ACP executor.

#### Scenario: ACP execution is routed normally
- **WHEN** a client calls `aai:exec` for an ACP-backed app
- **THEN** the gateway dispatches execution through the ACP executor
