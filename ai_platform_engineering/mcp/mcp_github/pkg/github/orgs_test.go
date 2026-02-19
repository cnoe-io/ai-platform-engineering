package github

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/github/github-mcp-server/internal/toolsnaps"
	"github.com/github/github-mcp-server/pkg/translations"
	"github.com/google/go-github/v82/github"
	"github.com/google/jsonschema-go/jsonschema"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func Test_InviteUserToOrg(t *testing.T) {
	t.Parallel()

	serverTool := InviteUserToOrg(translations.NullTranslationHelper)
	tool := serverTool.Tool
	require.NoError(t, toolsnaps.Test(tool.Name, tool))

	assert.Equal(t, "invite_user_to_org", tool.Name)
	assert.True(t, *tool.Annotations.DestructiveHint, "invite_user_to_org should be destructive")

	schema, ok := tool.InputSchema.(*jsonschema.Schema)
	require.True(t, ok, "InputSchema should be *jsonschema.Schema")
	assert.Contains(t, schema.Properties, "org")
	assert.Contains(t, schema.Properties, "email")
	assert.Contains(t, schema.Properties, "role")
	assert.ElementsMatch(t, schema.Required, []string{"org", "email"})

	mockInvitation := &github.Invitation{
		ID:    github.Ptr(int64(12345)),
		Email: github.Ptr("alice@cisco.com"),
		Role:  github.Ptr("direct_member"),
	}

	tests := []struct {
		name           string
		mockedClient   *http.Client
		requestArgs    map[string]any
		expectError    bool
		expectedErrMsg string
	}{
		{
			name: "successful invitation by email",
			mockedClient: MockHTTPClientWithHandlers(map[string]http.HandlerFunc{
				PostOrgsInvitationsByOrg: mockResponse(t, http.StatusCreated, mockInvitation),
			}),
			requestArgs: map[string]any{
				"org":   "cisco-eti",
				"email": "alice@cisco.com",
			},
			expectError: false,
		},
		{
			name: "successful invitation with role",
			mockedClient: MockHTTPClientWithHandlers(map[string]http.HandlerFunc{
				PostOrgsInvitationsByOrg: mockResponse(t, http.StatusCreated, mockInvitation),
			}),
			requestArgs: map[string]any{
				"org":   "cisco-eti",
				"email": "alice@cisco.com",
				"role":  "admin",
			},
			expectError: false,
		},
		{
			name: "missing org parameter",
			mockedClient: MockHTTPClientWithHandlers(map[string]http.HandlerFunc{
				PostOrgsInvitationsByOrg: mockResponse(t, http.StatusCreated, mockInvitation),
			}),
			requestArgs:    map[string]any{"email": "alice@cisco.com"},
			expectError:    true,
			expectedErrMsg: "missing required parameter: org",
		},
		{
			name: "missing email parameter",
			mockedClient: MockHTTPClientWithHandlers(map[string]http.HandlerFunc{
				PostOrgsInvitationsByOrg: mockResponse(t, http.StatusCreated, mockInvitation),
			}),
			requestArgs:    map[string]any{"org": "cisco-eti"},
			expectError:    true,
			expectedErrMsg: "missing required parameter: email",
		},
		{
			name: "API error - 422 already invited",
			mockedClient: MockHTTPClientWithHandlers(map[string]http.HandlerFunc{
				PostOrgsInvitationsByOrg: mockResponse(t, http.StatusUnprocessableEntity, map[string]string{
					"message": "Validation Failed",
				}),
			}),
			requestArgs: map[string]any{"org": "cisco-eti", "email": "alice@cisco.com"},
			expectError: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			client := github.NewClient(tc.mockedClient)
			deps := BaseDeps{
				Client: client,
			}
			handler := serverTool.Handler(deps)

			request := createMCPRequest(tc.requestArgs)
			result, err := handler(ContextWithDeps(context.Background(), deps), &request)
			require.NoError(t, err)

			if tc.expectError {
				require.True(t, result.IsError, "expected tool error")
				if tc.expectedErrMsg != "" {
					errorContent := getErrorResult(t, result)
					assert.Contains(t, errorContent.Text, tc.expectedErrMsg)
				}
				return
			}

			require.False(t, result.IsError, "unexpected tool error")
			textContent := getTextResult(t, result)

			var response map[string]any
			err = json.Unmarshal([]byte(textContent.Text), &response)
			require.NoError(t, err)

			assert.Equal(t, float64(12345), response["id"])
			assert.Equal(t, "alice@cisco.com", response["email"])
			assert.Equal(t, "direct_member", response["role"])
		})
	}
}
