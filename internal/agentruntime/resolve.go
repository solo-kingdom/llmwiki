package agentruntime

import (
	"fmt"
	"os/exec"
	"strings"

	"github.com/solo-kingdom/llmwiki/internal/acp"
	"github.com/solo-kingdom/llmwiki/internal/store/sqlite"
)

func Resolve(db *sqlite.DB, workspace string, mgr *acp.Manager, session *sqlite.IngestSession) (Runtime, error) {
	if session != nil && strings.EqualFold(session.AgentKind, KindACP) {
		raw, err := db.GetConfig("acp_agents_json")
		if err != nil {
			return nil, fmt.Errorf("%w: %v", ErrACPConfigInvalid, err)
		}
		cfg, err := acp.ParseConfig(raw)
		if err != nil {
			return nil, fmt.Errorf("%w: %w", ErrACPConfigInvalid, err)
		}
		agent, ok := cfg.Agent(session.ACPAgentID)
		if !ok {
			return nil, fmt.Errorf("%w: agent %q is not configured", ErrNoACPAgent, session.ACPAgentID)
		}
		if !agent.Enabled {
			return nil, fmt.Errorf("%w: %s", ErrACPAgentDisabled, agent.Name)
		}
		if _, err := exec.LookPath(agent.Command); err != nil {
			return nil, fmt.Errorf("%w: %s", ErrACPCLINotFound, agent.Command)
		}
		if mgr == nil {
			return nil, fmt.Errorf("%w: ACP manager is unavailable", ErrACPConfigInvalid)
		}
		return newACPRuntime(mgr, workspace, *cfg, agent), nil
	}
	return newNativeRuntime(db, workspace, session)
}
