package acp

import "testing"

func TestDecidePermissionMatrix(t *testing.T) {
	all := PermissionPolicy{AllowRead: true, AllowSearch: true, AllowFetch: true, AllowWrite: true, AllowExecute: true}
	none := PermissionPolicy{}
	options := []PermissionOption{
		{OptionID: "yes", Kind: "allow_once"},
		{OptionID: "no", Kind: "reject_once"},
	}
	tests := []struct {
		kind     string
		policy   PermissionPolicy
		readonly bool
		want     bool
		wantOut  string
	}{
		{"read", all, true, true, "selected"},
		{"read", none, false, false, "selected"},
		{"search", all, true, true, "selected"},
		{"search", none, false, false, "selected"},
		{"think", none, true, true, "selected"},
		{"fetch", all, true, true, "selected"},
		{"fetch", none, false, false, "selected"},
		{"edit", all, false, true, "selected"},
		{"edit", all, true, false, "selected"},
		{"delete", all, false, true, "selected"},
		{"move", all, false, true, "selected"},
		{"execute", all, false, true, "selected"},
		{"execute", all, true, false, "selected"},
		{"other", all, false, false, "selected"},
		{"frobnicate", all, false, false, "selected"},
		{"", all, false, false, "selected"},
	}
	for _, tt := range tests {
		decision := Decide(tt.policy, tt.readonly, PermissionRequest{ToolKind: tt.kind, Options: options})
		if decision.Allowed != tt.want || decision.Outcome != tt.wantOut {
			t.Errorf("kind=%q readonly=%v decision=%+v, want allowed=%v outcome=%s", tt.kind, tt.readonly, decision, tt.want, tt.wantOut)
		}
	}
}

func TestDecideNeverUsesAlwaysOptions(t *testing.T) {
	req := PermissionRequest{ToolKind: "read", Options: []PermissionOption{{OptionID: "a", Kind: "allow_always"}}}
	decision := Decide(PermissionPolicy{AllowRead: true}, true, req)
	if decision.Outcome != "cancelled" || decision.Reason != "no_matching_option" {
		t.Fatalf("decision = %+v, want cancelled/no_matching_option", decision)
	}
	req.Options = []PermissionOption{{OptionID: "r", Kind: "reject_always"}}
	decision = Decide(PermissionPolicy{}, true, req)
	if decision.Outcome != "cancelled" || decision.Reason != "no_matching_option" {
		t.Fatalf("decision = %+v, want cancelled/no_matching_option", decision)
	}
}

func TestCancelledDecision(t *testing.T) {
	decision := CancelledDecision(PermissionRequest{ToolKind: "execute", ToolTitle: "run"})
	if decision.Outcome != "cancelled" || decision.Reason != "turn_cancelled" || decision.Allowed {
		t.Fatalf("unexpected cancelled decision: %+v", decision)
	}
}
