package activity

import (
	"strings"
)

var sensitiveKeys = map[string]bool{
	"api_key": true, "apikey": true, "api-key": true,
	"authorization": true, "auth": true, "token": true,
	"password": true, "secret": true,
	"bearer": true, "cookie": true, "session_id": true,
	"request_body": true, "arguments": true, "tool_result": true,
}

// SanitizeDetails removes sensitive fields from details maps.
func SanitizeDetails(details map[string]interface{}) map[string]interface{} {
	if len(details) == 0 {
		return nil
	}
	out := make(map[string]interface{}, len(details))
	for k, v := range details {
		kl := strings.ToLower(k)
		if sensitiveKeys[kl] || strings.Contains(kl, "api_key") || strings.Contains(kl, "authorization") || strings.Contains(kl, "bearer") {
			continue
		}
		switch val := v.(type) {
		case map[string]interface{}:
			out[k] = SanitizeDetails(val)
		default:
			out[k] = v
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}
