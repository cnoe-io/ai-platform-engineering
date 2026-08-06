import {
  decodeGitHubPickerValue,
  encodeGitHubPickerValue,
  githubSourceKey,
} from "../github-repository";

it("round-trips stable GitHub metadata through the picker contract", () => {
  const source = {
    id: 42,
    node_id: "repository-node",
    full_name: "example/repository",
    html_url: "https://github.com/example/repository",
    default_branch: "trunk",
  };

  expect(decodeGitHubPickerValue(encodeGitHubPickerValue(source))).toEqual(
    source,
  );
  expect(githubSourceKey(source)).toBe("id:42");
});

it("normalizes legacy owner/name values without inventing a stable ID", () => {
  expect(decodeGitHubPickerValue("example/repository.git")).toEqual({
    full_name: "example/repository",
    html_url: "https://github.com/example/repository",
  });
});
