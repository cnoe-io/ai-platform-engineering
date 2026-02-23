// Package octicons provides helpers for working with GitHub Octicon icons.
// See https://primer.style/foundations/icons for available icons.
//
// Icons are optional and purely cosmetic. When the icons/ directory with
// PNG files is not present (e.g. in CI/Docker builds where .gitignore
// excludes *.png), all functions gracefully return empty/nil values and
// the MCP server operates normally without tool icons.
package octicons

import (
	"embed"
	"encoding/base64"
	"fmt"
	"io/fs"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// iconsFS holds embedded icon PNGs when they are available at build time.
// The icons directory may be absent in Docker/CI builds; in that case
// iconsFS is empty and all lookups return graceful fallbacks.
var iconsFS embed.FS

func init() {
	// Attempt to stat the icons dir inside the embed.  If the binary was
	// built without icons (the directory didn't exist), iconsFS is simply
	// an empty FS and every ReadFile call will return fs.ErrNotExist.
	if _, err := fs.Stat(iconsFS, "icons"); err != nil {
		// Expected in CI/Docker — icons not embedded; functions will
		// return empty strings / nil slices.
		_ = err
	}
}

// Theme represents the color theme of an icon.
type Theme string

const (
	// ThemeLight is for light backgrounds (dark/black icons).
	ThemeLight Theme = "light"
	// ThemeDark is for dark backgrounds (light/white icons).
	ThemeDark Theme = "dark"
)

// DataURI returns a data URI for the embedded Octicon PNG.
// The theme parameter specifies which variant to use:
//   - ThemeLight: dark icons for light backgrounds
//   - ThemeDark: light icons for dark backgrounds
//
// Returns an empty string when the icon is not embedded.
func DataURI(name string, theme Theme) string {
	filename := fmt.Sprintf("icons/%s-%s.png", name, theme)
	data, err := iconsFS.ReadFile(filename)
	if err != nil {
		return ""
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(data)
}

// Available reports whether any icons are embedded in this build.
func Available() bool {
	_, err := fs.Stat(iconsFS, "icons")
	return err == nil
}

// Icons returns MCP Icon objects for the given octicon name in light and dark themes.
// Returns nil when no icons are embedded or when the name is empty.
func Icons(name string) []mcp.Icon {
	if name == "" || !Available() {
		return nil
	}
	light := DataURI(name, ThemeLight)
	dark := DataURI(name, ThemeDark)
	if light == "" && dark == "" {
		return nil
	}
	return []mcp.Icon{
		{
			Source:   light,
			MIMEType: "image/png",
			Theme:    mcp.IconThemeLight,
		},
		{
			Source:   dark,
			MIMEType: "image/png",
			Theme:    mcp.IconThemeDark,
		},
	}
}
