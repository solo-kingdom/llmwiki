package ingest

import (
	"encoding/json"
	"log"
	"strings"
)

type PlanAction struct {
	Action      string   `json:"action"`
	Path        string   `json:"path"`
	FromPath    string   `json:"from_path,omitempty"`
	ToPath      string   `json:"to_path,omitempty"`
	SourcePaths []string `json:"source_paths,omitempty"`
	Rationale   string   `json:"rationale,omitempty"`
}

type planChangesJSON struct {
	Summary string       `json:"summary"`
	Changes []PlanAction `json:"changes"`
}

func ParsePlanActions(planJSON string) []PlanAction {
	var plan planChangesJSON
	if err := json.Unmarshal([]byte(planJSON), &plan); err != nil {
		log.Printf("ParsePlanActions: failed to parse plan JSON: %v", err)
		return nil
	}
	var result []PlanAction
	for _, change := range plan.Changes {
		switch change.Action {
		case "move":
			if change.FromPath != "" {
				result = append(result, change)
			}
		case "merge":
			if len(change.SourcePaths) > 0 {
				result = append(result, change)
			}
		}
	}
	return result
}

// PlanStructuralCounts returns move/merge counts and plan summary from plan JSON.
func PlanStructuralCounts(planJSON string) (moveCount, mergeCount int, summary string) {
	var plan planChangesJSON
	if err := json.Unmarshal([]byte(planJSON), &plan); err != nil {
		return 0, 0, ""
	}
	summary = strings.TrimSpace(plan.Summary)
	for _, change := range plan.Changes {
		switch change.Action {
		case "move":
			if change.FromPath != "" {
				moveCount++
			}
		case "merge":
			if len(change.SourcePaths) > 0 {
				mergeCount++
			}
		}
	}
	return moveCount, mergeCount, summary
}

func SourcePathsToDelete(actions []PlanAction, writeTargets map[string]string) []string {
	var toDelete []string
	for _, action := range actions {
		switch action.Action {
		case "move":
			src := action.FromPath
			if src == "" {
				continue
			}
			norm, err := NormalizeWikiFilePath(src)
			if err != nil {
				log.Printf("SourcePathsToDelete: skipping invalid move source %q: %v", src, err)
				continue
			}
			if _, isWrite := writeTargets[norm]; isWrite {
				continue
			}
			toDelete = append(toDelete, norm)
		case "merge":
			for _, src := range action.SourcePaths {
				if src == action.ToPath {
					continue
				}
				norm, err := NormalizeWikiFilePath(src)
				if err != nil {
					log.Printf("SourcePathsToDelete: skipping invalid merge source %q: %v", src, err)
					continue
				}
				if _, isWrite := writeTargets[norm]; isWrite {
					continue
				}
				toDelete = append(toDelete, norm)
			}
		}
	}
	return toDelete
}
