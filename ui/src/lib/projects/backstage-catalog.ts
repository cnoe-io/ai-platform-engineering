// assisted-by Cursor Composer

import { randomUUID } from "crypto";

import yaml from "js-yaml";

import type {
  BackstageComponentCatalog,
  BackstageProjectCatalog,
  ProjectDocument,
} from "@/types/projects";

function deriveSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");
}

export function buildProjectCatalog(input: {
  name: string;
  title?: string;
  description: string;
  teamSlug: string;
  domain: string;
  tags: string[];
  mailer?: string;
  manager?: string;
  ostinatoId?: string;
}): BackstageProjectCatalog {
  const slug = deriveSlug(input.name);
  const owner = `group:${input.teamSlug}`;

  return {
    apiVersion: "backstage.io/v1alpha1",
    kind: "System",
    metadata: {
      name: slug,
      title: input.title ?? input.name,
      description: input.description,
      annotations: {
        "cisco.com/esp-app-link": "",
        "pagerduty.com/service-id": "",
        "outshift.com/ostinato-id": input.ostinatoId ?? randomUUID(),
      },
      tags: input.tags.length > 0 ? input.tags : ["caipe"],
    },
    spec: {
      owner,
      domain: input.domain,
      type: "service",
      mailer: input.mailer,
      manager: input.manager,
      outshift: {
        rbac: {
          tools: [
            {
              name: "backstage",
              roles: { admins: input.teamSlug },
            },
            {
              name: "github",
              sync: true,
              roles: {
                contributors: input.teamSlug,
                maintainers: input.teamSlug,
              },
            },
            {
              name: "vault",
              roles: {
                developer: `outshift-vault-${slug}`,
              },
            },
          ],
        },
      },
    },
  };
}

export function buildDefaultComponents(
  projectSlug: string,
  teamSlug: string,
  projectTitle: string,
): BackstageComponentCatalog[] {
  const owner = `group:${teamSlug}`;

  return [
    {
      apiVersion: "backstage.io/v1alpha1",
      kind: "Component",
      metadata: {
        name: `${projectSlug}-api`,
        title: `${projectTitle} API`,
        description: `Primary service component for ${projectTitle}.`,
        tags: ["api"],
      },
      spec: {
        type: "service",
        lifecycle: "experimental",
        owner,
        system: projectSlug,
      },
    },
    {
      apiVersion: "backstage.io/v1alpha1",
      kind: "Component",
      metadata: {
        name: `${projectSlug}-ui`,
        title: `${projectTitle} UI`,
        description: `Web UI for ${projectTitle}.`,
        tags: ["website"],
      },
      spec: {
        type: "website",
        lifecycle: "experimental",
        owner,
        system: projectSlug,
      },
    },
  ];
}

export function catalogToYaml(
  catalog: BackstageProjectCatalog | BackstageComponentCatalog,
): string {
  return yaml.dump(catalog, { lineWidth: 100, noRefs: true }).trim();
}

export function projectCatalogBundleYaml(project: ProjectDocument): string {
  const parts = [
    "# Project System (Backstage catalog-info.yaml)",
    catalogToYaml(project.catalog),
    "",
    "# Associated Components",
    ...project.components.flatMap((component) => [
      catalogToYaml(component),
      "",
    ]),
  ];
  return parts.join("\n").trim();
}

export { deriveSlug as deriveProjectSlug };
