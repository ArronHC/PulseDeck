package models

import "strings"

// ThemeConfigurationManaged is the managed configuration wire format used by plugins and notification channels.
const ThemeConfigurationManaged = "managed"

// IsLocalizedText reports whether a manifest text field has a usable value.
func IsLocalizedText(value any) bool {
	switch text := value.(type) {
	case string:
		return strings.TrimSpace(text) != ""
	case map[string]any:
		for _, item := range text {
			if itemText, ok := item.(string); ok && strings.TrimSpace(itemText) != "" {
				return true
			}
		}
	case map[string]string:
		for _, item := range text {
			if strings.TrimSpace(item) != "" {
				return true
			}
		}
	}
	return false
}

type Configuration struct {
	Type string `json:"type"`
	Icon string `json:"icon"` // 图标
	Name any    `json:"name"`
	Data any    `json:"data"` // 配置数据
}

type ManagedThemeConfigurationItem struct {
	Key      string `json:"key"`
	Name     any    `json:"name"`
	Required bool   `json:"required"`
	Type     string `json:"type"` // string number select switch title textbox richtext nodes pingtasks
	Options  string `json:"options"`
	Default  any    `json:"default"`
	Help     any    `json:"help"`
}
