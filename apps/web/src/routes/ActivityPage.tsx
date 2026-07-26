import type { ActivityEvent, ActivityEventType } from "@agent-continuity/contracts";
import { ACTIVITY_EVENT_TYPES } from "@agent-continuity/contracts";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { LIVE_POLL_MS, client, useProject, useTasks } from "../api.js";
import { ProjectHeader } from "../components/ProjectHeader.js";
import { ErrorNote } from "../components/common.js";
import { EmptyState, Skeleton } from "../components/StatePlaceholders.js";
import { describeEvent, eventDetail, formatDateTime, formatTime } from "../format.js";
import { useInfiniteQuery } from "@tanstack/react-query";

export function ActivityPage() {
  const { project: ref } = useParams();
  const projectQuery = useProject(ref);
  const tasksQuery = useTasks(ref);

  const [task, setTask] = useState("");
  const [eventType, setEventType] = useState("");
  const [actor, setActor] = useState("");

  const query = useInfiniteQuery({
    queryKey: ["activity-page", ref, task, eventType, actor],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      client.activity.list(ref as string, {
        ...(task ? { task } : {}),
        ...(eventType ? { eventType: [eventType as ActivityEventType] } : {}),
        ...(actor ? { actor } : {}),
        limit: 50,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(ref),
    refetchInterval: LIVE_POLL_MS,
  });

  if (projectQuery.isLoading) return <Skeleton lines={4} />;
  if (!projectQuery.data) return <ErrorNote error={projectQuery.error} />;

  const events: ActivityEvent[] = (query.data?.pages ?? []).flatMap((page) => page.events);
  const actors = [
    ...new Set(events.map((event) => event.actor).filter((value): value is string => Boolean(value))),
  ];

  let lastDay = "";

  return (
    <>
      <ProjectHeader project={projectQuery.data} />
      <div className="page stack">
        <div className="spread">
          <h2>Activity</h2>
          <div className="row">
            <select
              value={task}
              onChange={(event) => setTask(event.target.value)}
              aria-label="Filter by task"
              className="filter-select"
            >
              <option value="">All tasks</option>
              {(tasksQuery.data ?? []).map((candidate) => (
                <option key={candidate.id} value={candidate.key}>
                  {candidate.key} — {candidate.title}
                </option>
              ))}
            </select>
            <select
              value={eventType}
              onChange={(event) => setEventType(event.target.value)}
              aria-label="Filter by event type"
              className="filter-select"
            >
              <option value="">All events</option>
              {ACTIVITY_EVENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <select
              value={actor}
              onChange={(event) => setActor(event.target.value)}
              aria-label="Filter by actor"
              className="filter-select"
            >
              <option value="">All actors</option>
              {actors.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {candidate}
                </option>
              ))}
            </select>
          </div>
        </div>

        <ErrorNote error={query.error} />
        {query.isLoading && <Skeleton lines={5} />}
        {events.length === 0 && !query.isLoading && (
          <EmptyState
            title="No activity yet"
            hint={
              task || eventType || actor
                ? "Nothing matches the current filters. Try widening or clearing them."
                : "Every claim, edit, decision and blocker on this project will show up here as it happens."
            }
          />
        )}

        {events.length > 0 && (
          <div className="timeline card">
            {events.map((event) => {
              const day = formatDateTime(event.createdAt).split(",")[0] ?? "";
              const showDay = day !== lastDay;
              lastDay = day;
              const detail = eventDetail(event.eventType, event.payload);

              return (
                <div key={event.id}>
                  {showDay && (
                    <h4 style={{ marginTop: 12 }}>{day}</h4>
                  )}
                  <div className="entry">
                    <time>{formatTime(event.createdAt)}</time>
                    <div>
                      <div>
                        <strong>{event.actor ?? "system"}</strong> {describeEvent(event.eventType)}
                        {event.taskKey && <span className="key"> {event.taskKey}</span>}
                      </div>
                      {detail && <div className="small muted">{detail}</div>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {query.hasNextPage && (
          <button onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage}>
            {query.isFetchingNextPage ? "Loading…" : "Load more"}
          </button>
        )}
      </div>
    </>
  );
}
