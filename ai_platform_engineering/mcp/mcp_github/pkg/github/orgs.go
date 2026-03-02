package github

import (
	"context"
	"fmt"

	ghErrors "github.com/github/github-mcp-server/pkg/errors"
	"github.com/github/github-mcp-server/pkg/inventory"
	"github.com/github/github-mcp-server/pkg/scopes"
	"github.com/github/github-mcp-server/pkg/translations"
	"github.com/github/github-mcp-server/pkg/utils"
	"github.com/google/go-github/v82/github"
	"github.com/google/jsonschema-go/jsonschema"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// InviteUserToOrg creates a tool to invite a user to a GitHub organization
// via email address, matching the POST /orgs/{org}/invitations API.
func InviteUserToOrg(t translations.TranslationHelperFunc) inventory.ServerTool {
	return NewTool(
		ToolsetMetadataOrgs,
		mcp.Tool{
			Name: "invite_user_to_org",
			Description: t("TOOL_INVITE_USER_TO_ORG_DESCRIPTION",
				"Invite a user to a GitHub organization by email address. "+
					"The authenticated user must be an organization owner. "+
					"The user will receive an email invitation to join the org."),
			Annotations: &mcp.ToolAnnotations{
				Title:           t("TOOL_INVITE_USER_TO_ORG_TITLE", "Invite user to organization"),
				DestructiveHint: ToBoolPtr(true),
			},
			InputSchema: &jsonschema.Schema{
				Type: "object",
				Properties: map[string]*jsonschema.Schema{
					"org": {
						Type:        "string",
						Description: t("TOOL_INVITE_USER_TO_ORG_ORG", "GitHub organization name (e.g. cisco-eti)"),
					},
					"email": {
						Type:        "string",
						Description: t("TOOL_INVITE_USER_TO_ORG_EMAIL", "Email address of the person to invite. Can be an existing GitHub user's email."),
					},
					"role": {
						Type: "string",
						Description: t("TOOL_INVITE_USER_TO_ORG_ROLE",
							"Role for the new member. Default is 'direct_member'."),
						Enum: []any{"admin", "direct_member", "billing_manager"},
					},
				},
				Required: []string{"org", "email"},
			},
		},
		[]scopes.Scope{scopes.AdminOrg},
		func(ctx context.Context, deps ToolDependencies, _ *mcp.CallToolRequest, args map[string]any) (*mcp.CallToolResult, any, error) {
			org, err := RequiredParam[string](args, "org")
			if err != nil {
				return utils.NewToolResultError(err.Error()), nil, nil
			}

			email, err := RequiredParam[string](args, "email")
			if err != nil {
				return utils.NewToolResultError(err.Error()), nil, nil
			}

			role, err := OptionalParam[string](args, "role")
			if err != nil {
				return utils.NewToolResultError(err.Error()), nil, nil
			}
			if role == "" {
				role = "direct_member"
			}

			client, err := deps.GetClient(ctx)
			if err != nil {
				return utils.NewToolResultErrorFromErr("failed to get GitHub client", err), nil, nil
			}

			opts := &github.CreateOrgInvitationOptions{
				Email: &email,
				Role:  &role,
			}

			invitation, res, err := client.Organizations.CreateOrgInvitation(ctx, org, opts)
			if err != nil {
				return ghErrors.NewGitHubAPIErrorResponse(ctx,
					fmt.Sprintf("failed to invite %s to org %s", email, org),
					res,
					err,
				), nil, nil
			}

			result := map[string]any{
				"id":    invitation.GetID(),
				"email": invitation.GetEmail(),
				"role":  invitation.GetRole(),
				"login": invitation.GetLogin(),
			}
			if invitation.CreatedAt != nil {
				result["created_at"] = invitation.CreatedAt.Time.String()
			}

			return MarshalledTextResult(result), nil, nil
		},
	)
}
