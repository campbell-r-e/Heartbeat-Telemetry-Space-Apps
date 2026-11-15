import { BADGE_IDS, type BadgeId } from "@heartbeat/shared";
import type { BadgeStore, EarnedBadge } from "../domain/ports.ts";
import type { Queryable } from "./pool.ts";

interface BadgeRow { badge_id: string; earned_on: string }

const isBadgeId = (id: string): id is BadgeId => (BADGE_IDS as readonly string[]).includes(id);

/** Badges stored once earned and never removed (SPEC §7, owner decision). */
export function badgesRepo(db: Queryable): BadgeStore {
  const earned = async (astronautId: string): Promise<EarnedBadge[]> => {
    const { rows } = await db.query<BadgeRow>("SELECT badge_id, earned_on FROM badges WHERE astronaut_id = $1", [astronautId]);
    // A badge no longer defined in BADGE_IDS stays stored but is not served.
    return rows.flatMap((row) => (isBadgeId(row.badge_id) ? [{ badgeId: row.badge_id, earnedOn: row.earned_on }] : []));
  };

  return {
    earned,

    async record(astronautId, badges, atMs) {
      if (badges.length > 0) {
        // ON CONFLICT DO NOTHING: a stored badge keeps its day, so two recomputes at once agree.
        await db.query(
          `INSERT INTO badges (astronaut_id, badge_id, earned_on, recorded_ms)
           SELECT $1, badge_id, earned_on, $4 FROM unnest($2::text[], $3::text[]) AS b(badge_id, earned_on)
           ON CONFLICT (astronaut_id, badge_id) DO NOTHING`,
          [astronautId, badges.map((b) => b.badgeId), badges.map((b) => b.earnedOn), atMs],
        );
      }
      return earned(astronautId);
    },
  };
}
