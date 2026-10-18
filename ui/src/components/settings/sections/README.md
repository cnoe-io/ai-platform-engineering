# Release announcements

- The platform announcement switch and each user's notification preference are
  independent. Existing deployed-version release notes remain the default.
- Administrators may configure `repository_url`, `previous_commit`, and
  `latest_commit` together, or clear all three. Refs may be commit SHAs,
  ordinary branch names, or tags. Repository URLs must identify GitHub
  owner/repository coordinates, without credentials, ports, query or fragment.
- The announcement toggle PATCH changes only `release_notes.enabled`. A range
  PATCH changes only its three fields, so concurrent toggle/range writes cannot
  overwrite one another. Edits made during a save remain dirty.
- `GET /api/release-notes?version=...&compare=platform` authenticates through the
  shared bearer/session provider on every request before reading configuration,
  cache, or GitHub. Ordinary admitted users may read configured announcements;
  configuration writes retain existing administrator and resource gates.
- Configuring a private repository shares its commit subjects and links with
  those admitted users. Choose an appropriate announcement repository/range.
  Raw source and access tokens are not returned.
- The server uses `RELEASE_NOTES_GITHUB_TOKEN`, then `GITHUB_TOKEN`, then
  `GITHUB_PERSONAL_ACCESS_TOKEN`. Private responses are `private, no-store`.
  The bounded in-process compare cache is not an authentication cache.
- Requests do not accept arbitrary repository coordinates. GitHub redirects are
  rejected, fetch and response-body reads are timed out, and pagination fails
  rather than silently returning a partial comparison at its limit.
- A build-provided `public/main-increment-release-notes.json` may supply notes
  for its exact version. This is a public build artifact, not a private
  GitHub-token read. Do not place confidential material in public artifacts.
