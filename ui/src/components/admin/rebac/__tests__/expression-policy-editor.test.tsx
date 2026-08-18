import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ExpressionPolicyEditor } from "../expression-policy-editor";
import { PolicyEffectiveness } from "../policy-effectiveness";

const tools = [{
  ref: "issue_tracker/create_item",
  name: "Issue tracker: create item",
  schema_hash: `sha256:${"a".repeat(64)}`,
  eligible_fields: [
    { pointer: "/project_key", type: "string" as const, required: true },
    { pointer: "/count", type: "integer" as const, required: false },
  ],
}];

describe("ExpressionPolicyEditor", () => {
  it("builds a typed template without exposing raw expression source", async () => {
    const onSave = jest.fn(async () => undefined);
    render(<ExpressionPolicyEditor tools={tools} onSave={onSave} />);

    expect(screen.queryByLabelText(/CEL|Cedar|Rego/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Policy ID"), { target: { value: "primary-create" } });
    fireEvent.change(screen.getByLabelText("Subject ID"), { target: { value: "example-user" } });
    fireEvent.change(screen.getByLabelText("Allowed values"), { target: { value: "request.drop(), PRIMARY" } });
    fireEvent.click(screen.getByRole("button", { name: "Validate and save" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      policy_id: "primary-create",
      expression: {
        template: "string_argument_in_v1",
        version: "1",
        field: "/project_key",
        values: ["PRIMARY", "request.drop()"],
      },
    })));
  });
});

describe("PolicyEffectiveness", () => {
  it("explains additive wildcard shadowing", () => {
    render(<PolicyEffectiveness exclusive={false} warnings={["wildcard_allow"]} />);
    expect(screen.getByText("Additive policy")).toBeInTheDocument();
    expect(screen.getByText(/wildcard grant/i)).toBeInTheDocument();
    expect(screen.getByText(/Derived access can change/i)).toBeInTheDocument();
  });
});
