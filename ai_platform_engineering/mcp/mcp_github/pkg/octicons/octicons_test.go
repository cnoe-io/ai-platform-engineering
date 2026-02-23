package octicons

import (
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/stretchr/testify/assert"
)

func TestDataURI(t *testing.T) {
	if !Available() {
		t.Skip("icon PNGs not embedded in this build")
	}

	tests := []struct {
		name        string
		icon        string
		theme       Theme
		wantDataURI bool
		wantEmpty   bool
	}{
		{
			name:        "light theme icon returns data URI",
			icon:        "repo",
			theme:       ThemeLight,
			wantDataURI: true,
			wantEmpty:   false,
		},
		{
			name:        "dark theme icon returns data URI",
			icon:        "repo",
			theme:       ThemeDark,
			wantDataURI: true,
			wantEmpty:   false,
		},
		{
			name:        "non-embedded icon returns empty string",
			icon:        "nonexistent-icon",
			theme:       ThemeLight,
			wantDataURI: false,
			wantEmpty:   true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := DataURI(tc.icon, tc.theme)
			if tc.wantDataURI {
				assert.True(t, strings.HasPrefix(result, "data:image/png;base64,"), "expected data URI prefix")
				assert.NotContains(t, result, "https://")
			}
			if tc.wantEmpty {
				assert.Empty(t, result, "expected empty string for non-embedded icon")
			}
		})
	}
}

func TestIcons(t *testing.T) {
	t.Run("empty name returns nil", func(t *testing.T) {
		result := Icons("")
		assert.Nil(t, result)
	})

	t.Run("icons unavailable returns nil", func(t *testing.T) {
		if Available() {
			t.Skip("icons are available — this case only applies in CI/Docker")
		}
		result := Icons("repo")
		assert.Nil(t, result)
	})

	t.Run("valid embedded icon returns light and dark variants", func(t *testing.T) {
		if !Available() {
			t.Skip("icon PNGs not embedded in this build")
		}
		result := Icons("repo")
		assert.NotNil(t, result)
		assert.Len(t, result, 2)

		assert.Equal(t, DataURI("repo", ThemeLight), result[0].Source)
		assert.Equal(t, "image/png", result[0].MIMEType)
		assert.Equal(t, mcp.IconThemeLight, result[0].Theme)

		assert.Equal(t, DataURI("repo", ThemeDark), result[1].Source)
		assert.Equal(t, "image/png", result[1].MIMEType)
		assert.Equal(t, mcp.IconThemeDark, result[1].Theme)
	})
}

func TestThemeConstants(t *testing.T) {
	assert.Equal(t, Theme("light"), ThemeLight)
	assert.Equal(t, Theme("dark"), ThemeDark)
}

func TestAvailable(t *testing.T) {
	// Just verify it returns a bool without panicking
	_ = Available()
}
