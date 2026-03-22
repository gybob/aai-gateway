## 1. Northbound Server Transport

- [x] 1.1 Add gateway configuration and CLI startup options for northbound `streamable-http` serving, including bind host, port, and path.
- [x] 1.2 Replace the existing northbound stdio bootstrap with a `streamable-http` bootstrap and delete obsolete stdio-facing server code.
- [x] 1.3 Add tests covering gateway startup and MCP connectivity in `streamable-http` mode.

## 2. Client Runtime Isolation

- [x] 2.1 Introduce a client-scoped runtime context that stores caller identity and other northbound connection state outside server-global fields.
- [x] 2.2 Update request handling and observers to use the client-scoped runtime context.
- [x] 2.3 Change ACP session reuse to key by client context and app local ID, with tests for concurrent multi-client access.

## 3. ACP Streaming Bridge

- [x] 3.1 Extend the ACP observer/update pipeline so `session/update` events can be forwarded incrementally through the active client-facing execution channel.
- [x] 3.2 Update `aai:exec` ACP prompt handling so long-running prompts succeed through streamed incremental output without relying on MCP task support.
- [x] 3.3 Add integration tests for long-running ACP prompts over `streamable-http`, including multi-update delivery and final result completion.

## 4. Validation and Documentation

- [x] 4.1 Update skill guidance generation and docs so upstream AI tools are told the gateway-managed skill base path.
- [x] 4.2 Update README and manual testing guidance to document the replacement of northbound stdio with `streamable-http` and the multi-client runtime model.
- [x] 4.3 Run targeted server, ACP, and skill test suites plus OpenSpec validation for `add-streamable-http-northbound`.
