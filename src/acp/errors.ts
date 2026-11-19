export class AcpError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "AcpError";
  }
}

export const ErrCLINotFound = "acp_cli_not_found";
export const ErrProtocolVersionUnsupported = "acp_protocol_version_unsupported";
export const ErrTooManyAgents = "acp_too_many_agents";
export const ErrCancelTimeout = "acp_cancel_timeout";

export function cliNotFound(command: string, detail: string): AcpError {
  return new AcpError(`${ErrCLINotFound}: ${command}: ${detail}`, ErrCLINotFound);
}

export function protocolVersionUnsupported(requested: number): AcpError {
  return new AcpError(
    `${ErrProtocolVersionUnsupported}: agent requested protocolVersion=${requested}, llmwiki supports 1`,
    ErrProtocolVersionUnsupported,
  );
}
