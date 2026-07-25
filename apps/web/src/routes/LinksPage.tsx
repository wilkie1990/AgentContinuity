import type { Link } from "@agent-workspace/contracts";
import { useParams } from "react-router-dom";
import { client, useLinks, useProject, useWorkspaceMutation } from "../api.js";
import { ProjectHeader } from "../components/ProjectHeader.js";
import { Empty, ErrorNote, Loading } from "../components/common.js";

function groupByType(links: Link[]): [string, Link[]][] {
  const groups = new Map<string, Link[]>();
  for (const link of links) {
    const list = groups.get(link.type) ?? [];
    list.push(link);
    groups.set(link.type, list);
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function title(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1) + (type.endsWith("s") ? "" : "s");
}

export function LinksPage() {
  const { project: ref } = useParams();
  const projectQuery = useProject(ref);
  const { data, isLoading, error } = useLinks(ref);
  const remove = useWorkspaceMutation(ref, (key: string) => client.links.remove(key));

  if (projectQuery.isLoading) return <Loading />;
  if (!projectQuery.data) return <ErrorNote error={projectQuery.error} />;

  return (
    <>
      <ProjectHeader project={projectQuery.data} />
      <div className="page stack">
        <h2>Links</h2>
        <ErrorNote error={error ?? remove.error} />
        {isLoading && <Loading />}
        {(data ?? []).length === 0 && (
          <Empty>No links. Agents attach issues, branches and documents as generic links.</Empty>
        )}

        {groupByType(data ?? []).map(([type, links]) => (
          <div className="card link-group" key={type}>
            <h3>{title(type)}</h3>
            {links.map((link) => (
              <div className="spread" key={link.id}>
                <div className="small">
                  {link.url ? (
                    <a href={link.url} target="_blank" rel="noreferrer">
                      {link.reference ?? link.url}
                    </a>
                  ) : (
                    (link.reference ?? "—")
                  )}
                  {link.provider && <span className="muted"> · {link.provider}</span>}
                  {link.taskKey && <span className="key"> · {link.taskKey}</span>}
                </div>
                <button className="subtle danger" onClick={() => remove.mutate(link.key)}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
