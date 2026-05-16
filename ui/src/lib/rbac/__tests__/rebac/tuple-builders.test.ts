import {
  buildOpenFgaTuple,
  buildOpenFgaTupleDiff,
  openFgaObject,
  openFgaRelation,
  openFgaSubject,
} from "../../tuple-builders";

describe("universal ReBAC OpenFGA tuple builders", () => {
  it("formats subjects and resources with OpenFGA type:id syntax", () => {
    expect(openFgaSubject({ type: "user", id: "alice-sub" })).toBe("user:alice-sub");
    expect(openFgaSubject({ type: "team", id: "platform", relation: "member" })).toBe(
      "team:platform#member"
    );
    expect(openFgaObject({ type: "slack_channel", id: "T1--C1" })).toBe("slack_channel:T1--C1");
  });

  it("maps universal actions to stable OpenFGA relation names", () => {
    expect(openFgaRelation("use")).toBe("can_use");
    expect(openFgaRelation("read-metadata")).toBe("can_read_metadata");
    expect(openFgaRelation("call")).toBe("can_call");
    expect(openFgaRelation("invoke")).toBe("can_invoke");
  });

  it("builds a tuple from a validated universal relationship", () => {
    expect(
      buildOpenFgaTuple({
        subject: { type: "team", id: "platform", relation: "member" },
        action: "call",
        resource: { type: "tool", id: "argocd" },
      })
    ).toEqual({
      user: "team:platform#member",
      relation: "can_call",
      object: "tool:argocd",
    });
  });

  it("rejects unsupported relationship actions before producing tuples", () => {
    expect(() =>
      buildOpenFgaTuple({
        subject: { type: "team", id: "platform", relation: "member" },
        action: "approve",
        resource: { type: "tool", id: "argocd" },
      })
    ).toThrow("Resource type tool does not support action approve");
  });

  it("builds unique write and delete tuple diffs", () => {
    const relationship = {
      subject: { type: "user" as const, id: "alice-sub" },
      action: "read" as const,
      resource: { type: "knowledge_base" as const, id: "platform-runbooks" },
    };

    expect(
      buildOpenFgaTupleDiff({
        writes: [relationship, relationship],
        deletes: [relationship],
      })
    ).toEqual({
      writes: [
        {
          user: "user:alice-sub",
          relation: "can_read",
          object: "knowledge_base:platform-runbooks",
        },
      ],
      deletes: [
        {
          user: "user:alice-sub",
          relation: "can_read",
          object: "knowledge_base:platform-runbooks",
        },
      ],
    });
  });
});
