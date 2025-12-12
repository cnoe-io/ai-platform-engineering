# GitHub Ingestor

Fetches data from GitHub organizations using the GraphQL API and ingests it into the RAG system.

## What It Extracts

### Graph Entities
- **Organizations** - Metadata (login, name, description, location, social links)
- **Repositories** - Metadata + security settings (vulnerability alerts, security policies, languages, stars/forks)
- **Users** - Profiles with bio, email, organization memberships, owned repositories
  - **Optional**: Organization verified domain emails (with `FETCH_ORG_EMAILS=true`)
- **Teams** - Details with member lists (including roles) and repository permissions

## Authentication

### Method 1: Personal Access Token (PAT)
Simple setup, good for development and testing.

#### Creating a PAT

1. **Go to GitHub Settings**
   - Click your profile photo (top-right) → Settings
   - Navigate to: Developer settings → Personal access tokens → Tokens (classic)

2. **Generate New Token**
   - Click "Generate new token (classic)"
   - Give it a descriptive name (e.g., "RAG Ingestor - Dev")
   - Set expiration (recommended: 90 days)

3. **Select Required Scopes**
   
   **For Public Repositories Only:**
   - ✅ `public_repo` - Access public repositories
   - ✅ `read:org` - Read organization membership, teams, and data
   - ✅ `read:user` - Read user profile data
   
   **For Private Repositories:**
   - ✅ `repo` - Full control of private repositories (includes public)
     - This grants: `repo:status`, `repo_deployment`, `public_repo`, `repo:invite`, `security_events`
   - ✅ `read:org` - Read organization membership, teams, and data
   - ✅ `read:user` - Read user profile data

4. **Generate and Copy Token**
   - Click "Generate token"
   - **⚠️ Copy the token immediately** - you won't be able to see it again!
   - Store securely (password manager, secrets vault)

5. **Use the Token**
   ```bash
   export GITHUB_TOKEN="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
   ```

### Method 2: GitHub App (Recommended for Production)
More secure with higher rate limits (15,000 vs 5,000 requests/hour).

#### Creating a GitHub App

**Step 1: Create the App**

1. **Navigate to Organization Settings**
   - Go to your organization on GitHub
   - Click "Settings" (organization settings, not personal)
   - In the left sidebar: Developer settings → GitHub Apps

2. **Click "New GitHub App"**

3. **Fill in Basic Information**
   - **GitHub App name**: `RAG Ingestor` (or your preferred name)
   - **Homepage URL**: Your organization's URL or `https://github.com/your-org`
   - **Description**: `Ingests GitHub data into RAG system` (optional)

4. **Webhook Configuration**
   - ❌ **Uncheck** "Active" under "Webhook"
   - (We don't need webhooks for this ingestor)

5. **Permissions** (Important!)
   
   **Repository permissions:**
   - ✅ **Contents**: `Read-only` - Read repository content (files, commits)
   - ✅ **Metadata**: `Read-only` - Read repository metadata (automatically granted)
   
   **Organization permissions:**
   - ✅ **Members**: `Read-only` - Read organization members and teams
   - ✅ **Administration**: `Read-only` - Read organization settings and team membership
   
   **Account permissions:** (none needed)

6. **Where can this GitHub App be installed?**
   - Select: "Only on this account"

7. **Click "Create GitHub App"**

**Step 2: Generate Private Key**

1. After creating the app, you'll be on the app settings page
2. Scroll down to "Private keys" section
3. Click "Generate a private key"
4. A `.pem` file will download automatically
5. **⚠️ Store this file securely** - treat it like a password!

**Step 3: Note Your App ID**

1. At the top of the app settings page, you'll see "App ID"
2. Copy this number (e.g., `123456`)
3. Save it for later use

**Step 4: Install the App**

1. In the left sidebar of app settings, click "Install App"
2. Click "Install" next to your organization
3. Choose repository access:
   - **All repositories** (recommended for full coverage)
   - OR **Only select repositories** (choose specific repos)
4. Click "Install"

**Step 5: Get Installation ID**

1. After installation, you'll be redirected to a URL like:
   ```
   https://github.com/organizations/YOUR-ORG/settings/installations/12345678
   ```
2. The number at the end (`12345678`) is your **Installation ID**
3. Copy this number

**Step 6: Gather Credentials**

You now have all three required credentials:
- ✅ **App ID**: `123456` (from Step 3)
- ✅ **Private Key**: `/path/to/downloaded-file.pem` (from Step 2)
- ✅ **Installation ID**: `12345678` (from Step 5)

**Step 7: Use the Credentials**

```bash
export GITHUB_APP_ID="123456"
export GITHUB_APP_PRIVATE_KEY="/path/to/your-app.pem"
export GITHUB_APP_INSTALLATION_ID="12345678"
export GITHUB_ORG="your-org-name"
```

#### Permissions Summary

| Permission Type | Permission | Access Level | Required For |
|----------------|------------|--------------|--------------|
| **Repository** | Contents | Read-only | Repository files, commits |
| **Repository** | Metadata | Read-only | Repository metadata |
| **Organization** | Members | Read-only | User profiles, team membership |
| **Organization** | Administration | Read-only | Organization data, teams |

**Note:** These are **read-only** permissions. The app cannot modify anything in your organization.

## Configuration

### Using PAT
```bash
export GITHUB_TOKEN="ghp_your_token_here"
export GITHUB_ORG="your-org-name"
```

### Using GitHub App

**Option A: With PEM file**
```bash
export GITHUB_APP_ID="123456"
export GITHUB_APP_PRIVATE_KEY="/path/to/your-app.pem"
export GITHUB_APP_INSTALLATION_ID="12345678"
export GITHUB_ORG="your-org-name"
```

**Option B: Base64 encoded**
```bash
export GITHUB_APP_ID="123456"
export GITHUB_APP_PRIVATE_KEY="$(base64 -w 0 < your-app.pem)"  # Linux
# or
export GITHUB_APP_PRIVATE_KEY="$(base64 -i your-app.pem)"      # macOS
export GITHUB_APP_INSTALLATION_ID="12345678"
export GITHUB_ORG="your-org-name"
```

### Optional Settings
- `GITHUB_API_URL` - Default: `https://api.github.com/graphql`
- `SYNC_INTERVAL` - Default: `86400` (24 hours)
- `FETCH_TEAM_DETAILS` - Default: `true` - Fetch detailed team members and repository permissions (adds ~400 API calls for 200 teams)
- `FETCH_ORG_EMAILS` - Default: `false` - Fetch organization verified domain emails for users (requires org membership, uses same API calls)
- `LOG_LEVEL` - Default: `INFO`

## Running

### Local Development
```bash
cd ingestors
uv sync
source .venv/bin/activate

# Set environment variables (see Configuration above)
export RAG_SERVER_URL="http://localhost:9446"

python src/ingestors/github/ingestor.py
```

### Docker Compose

See `docker-compose.yaml` for configurations. Run with:

```bash
# Using PAT
docker compose --profile github up

# Using GitHub App
docker compose --profile github-app up
```

## Troubleshooting

### Authentication Errors

**PAT Authentication**
```
Error: Authentication required...
```
- Ensure `GITHUB_TOKEN` is set with a valid token
- Verify token has not expired
- Check token has required scopes (`read:org`, `repo`, `read:user`)

**GitHub App Authentication**
```
Error generating JWT...
```
- Verify private key format is correct (PEM format)
- If base64 encoded, ensure no line breaks

```
Error getting installation token...
```
- Verify App ID, Installation ID are correct
- Ensure app is installed on the organization
- Check app has required permissions

### Organization Access Errors
```
Error fetching organization...
```
- Verify `GITHUB_ORG` value is correct
- For PAT: Check token has access to the organization
- For App: Ensure app is installed on the organization

### Rate Limit Errors

```
GraphQL errors: Rate limit exceeded
```

**For PAT Users:**
- PAT has 5,000 requests per hour
- Increase `SYNC_INTERVAL` to sync less frequently
- Set `INGEST_ISSUES=false` to skip issue ingestion
- Reduce `MAX_ISSUES_PER_REPO`
- **Recommended:** Switch to GitHub App (15,000 requests/hour)

**For GitHub App Users:**
- GitHub Apps have 15,000 requests per hour per installation
- If still hitting limits, increase `SYNC_INTERVAL`
- Reduce `MAX_ISSUES_PER_REPO` or disable issues

### Connection Errors
```
Error making GraphQL request...
```
- Check network connectivity to GitHub
- Verify `GITHUB_API_URL` is correct
- Check firewall/proxy settings

## Rate Limits

| Auth Method | Requests/Hour | Best For |
|-------------|---------------|----------|
| PAT | 5,000 | Development, small orgs |
| GitHub App | 15,000 | Production, large orgs |

### API Call Estimation

The ingestor uses pagination (50 items per page) for all resources. Here's how to estimate calls:

**Per Sync:**
1. Organization metadata: 1 call
2. Repositories: `ceil(repo_count / 50)` calls
3. Teams: `ceil(team_count / 50)` calls
4. Organization members: `ceil(user_count / 50)` calls
5. **Team details** (if `FETCH_TEAM_DETAILS=true`):
   - Team members: `team_count × ceil(avg_team_size / 50)` calls
   - Team repository permissions: `team_count × ceil(avg_repos_per_team / 50)` calls

**Example: Small-Medium Organization**
- 666 repositories
- 282 users
- 204 teams

**With `FETCH_TEAM_DETAILS=false`:**
- Organization: 1
- Repositories: 14 (666 ÷ 50)
- Teams: 5 (204 ÷ 50)
- Users: 6 (282 ÷ 50)
- **Total: ~26 calls per sync** ⚡
- Calls per hour (15-min interval): **~104 calls/hour**

**With `FETCH_TEAM_DETAILS=true` (default):**
- Organization: 1
- Repositories: 14
- Teams: 5
- Users: 6
- Team members: 204 (1 call per team, avg < 50 members)
- Team repos: 204 (1 call per team, avg < 50 repos)
- **Total: ~434 calls per sync**
- Calls per hour (15-min interval): **~1,736 calls/hour**

**Recommendation:**
- Use `FETCH_TEAM_DETAILS=false` (default) for most cases
- Team metadata (name, slug, description, counts) is still included
- Only enable if you need detailed member lists and repository permissions