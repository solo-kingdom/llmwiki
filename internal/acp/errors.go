package acp

import "errors"

var (
	ErrCLINotFound                = errors.New("ACP CLI not found")
	ErrProtocolVersionUnsupported = errors.New("ACP protocol version unsupported")
	ErrTooManyAgents              = errors.New("too many ACP agents")
	ErrCancelTimeout              = errors.New("ACP cancel timeout")
)
