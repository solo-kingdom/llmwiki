package llm

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const defaultProbeTimeout = 15 * time.Second

// Probe checks provider connectivity with a lightweight HTTP request.
func (c *Client) Probe(ctx context.Context) error {
	if err := c.validateRequest(); err != nil {
		return err
	}
	if ctx == nil {
		ctx = context.Background()
	}
	ctx, cancel := context.WithTimeout(ctx, defaultProbeTimeout)
	defer cancel()

	url, method := c.probeRequest()
	req, err := http.NewRequestWithContext(ctx, method, url, nil)
	if err != nil {
		return fmt.Errorf("create probe request: %w", err)
	}
	c.setHeaders(req)

	client := &http.Client{Timeout: defaultProbeTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("probe request failed: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	switch resp.StatusCode {
	case http.StatusOK, http.StatusNoContent:
		return nil
	case http.StatusUnauthorized, http.StatusForbidden:
		return classifyError(resp.StatusCode, string(body))
	default:
		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			return nil
		}
		return classifyError(resp.StatusCode, string(body))
	}
}

func (c *Client) probeRequest() (url, method string) {
	base := strings.TrimRight(c.config.BaseURL, "/")
	switch c.config.Provider {
	case "anthropic":
		return base + "/models", http.MethodGet
	case "ollama":
		return base + "/api/tags", http.MethodGet
	default:
		return base + "/models", http.MethodGet
	}
}
