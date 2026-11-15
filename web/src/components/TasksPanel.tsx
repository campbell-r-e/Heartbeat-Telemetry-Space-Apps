import Link from "next/link";
import type { Badge, PointsSummary, ScheduledTaskKind, TaskState } from "@heartbeat/shared";
import { CHECK_IN_PATH, MEAL_PICKER_PATH } from "@/lib/domain/areas";
import { formatUtcClock } from "@/lib/domain/format";
import type { Loaded } from "@/lib/domain/onboard-response";
import { badgeStateText, loadedEarnedTodayText, taskPointsText } from "@/lib/domain/points";
import { taskSummary } from "@/lib/domain/schedule";
import styles from "./dashboard.module.css";

type TaskAction = { kind: "link"; href: string; text: string } | { kind: "where"; text: string };

const TASK_ACTION: Record<ScheduledTaskKind, TaskAction> = {
  ecg: { kind: "where", text: "On the watch" },
  spo2: { kind: "where", text: "On the watch" },
  checkIn: { kind: "link", href: CHECK_IN_PATH, text: "Check in" },
  meal: { kind: "link", href: MEAL_PICKER_PATH, text: "Log a meal" },
  exercise: { kind: "where", text: "Counted from heart rate" },
};

/** Done state from the server's record of real activity (no manual ticking, decision 2). */
function DoneMark({ done }: { done: boolean }) {
  return (
    <span className={styles.doneMark} data-done={done}>
      <span aria-hidden="true">{done ? "✓" : ""}</span>
      <span className="srOnly">{done ? "Done" : "Not done yet"}</span>
    </span>
  );
}

function TaskActionView({ action }: { action: TaskAction }) {
  if (action.kind === "where") return <span className={styles.taskWhere}>{action.text}</span>;
  return (
    <Link href={action.href} className={styles.taskAction}>
      {action.text}
    </Link>
  );
}

function TaskItem({ task }: { task: TaskState }) {
  const points = taskPointsText(task);
  return (
    <li className={styles.task}>
      <DoneMark done={task.done} />
      <span className={styles.taskTime}>{task.localTime ?? "Today"}</span>
      <span className={styles.taskLabel}>
        {task.label}
        {task.doneAt && <span className={styles.taskProgress}> · done {formatUtcClock(task.doneAt)}</span>}
        {task.progress && (
          <span className={styles.taskProgress}>
            {" "}
            · {task.progress.value} / {task.progress.goal} {task.progress.unit}
          </span>
        )}
      </span>
      {points && (
        <span className={styles.taskPoints}>
          {points}
          <span className="srOnly"> points</span>
        </span>
      )}
      <TaskActionView action={TASK_ACTION[task.kind]} />
    </li>
  );
}

function BadgeItem({ badge }: { badge: Badge }) {
  return (
    <li className={styles.badge} data-earned={badge.earnedOn !== null}>
      <span className={styles.badgeName}>{badge.name}</span>
      <span className="muted">{badge.description}</span>
      <span className={styles.badgeState}>{badgeStateText(badge)}</span>
    </li>
  );
}

/**
 * Today's tasks with their points, and the badges (SPEC §7, §9.1); every number is the server's. If
 * the points could not be loaded, only the points line and the badges say so.
 */
export function TasksPanel({ tasks, points }: { tasks: TaskState[]; points: Loaded<PointsSummary> }) {
  return (
    <section aria-labelledby="tasks-title" className="panel">
      <div className={styles.tasksHead}>
        <h2 id="tasks-title" className="panelTitle">
          Today&apos;s tasks
        </h2>
        <span className="muted">
          {taskSummary(tasks)} · {loadedEarnedTodayText(points)} · times in UTC (spacecraft time)
        </span>
      </div>
      <ul className={styles.tasks}>
        {tasks.map((task) => (
          <TaskItem key={task.taskId} task={task} />
        ))}
      </ul>
      <h3 className={styles.badgesTitle}>Badges</h3>
      {points.ok ? (
        <ul className={styles.badges}>
          {points.value.badges.map((badge) => (
            <BadgeItem key={badge.id} badge={badge} />
          ))}
        </ul>
      ) : (
        <p className="muted">Badges unavailable: {points.problem}</p>
      )}
    </section>
  );
}
