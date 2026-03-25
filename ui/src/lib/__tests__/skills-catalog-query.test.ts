import { applySkillsCatalogQueryToBackendUrl } from "../skills-catalog-query";

describe("applySkillsCatalogQueryToBackendUrl", () => {
  it("forwards q, source, visibility, page, page_size, tags, include_content", () => {
    const url = new URL("https://backend.example/skills");
    const sp = new URLSearchParams();
    sp.set("q", "aws");
    sp.set("source", "hub");
    sp.set("visibility", "team");
    sp.set("tags", "a,b");
    sp.set("include_content", "true");
    sp.set("page", "2");
    sp.set("page_size", "25");
    applySkillsCatalogQueryToBackendUrl(url, sp);
    expect(url.searchParams.get("q")).toBe("aws");
    expect(url.searchParams.get("source")).toBe("hub");
    expect(url.searchParams.get("visibility")).toBe("team");
    expect(url.searchParams.get("tags")).toBe("a,b");
    expect(url.searchParams.get("include_content")).toBe("true");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("page_size")).toBe("25");
  });

  it("omits empty optional params", () => {
    const url = new URL("https://backend.example/skills");
    applySkillsCatalogQueryToBackendUrl(url, new URLSearchParams());
    expect([...url.searchParams.keys()].length).toBe(0);
  });
});
