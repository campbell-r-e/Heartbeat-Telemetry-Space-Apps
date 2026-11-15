// Which crew member this browser shows (decision 13): the first astronaut by default, remembered
// per browser in a cookie.

import type { Astronaut } from "@heartbeat/shared";
import { ONE_YEAR_S } from "./domain/time";

export const CREW_COOKIE = "astronaut";
export const CREW_COOKIE_MAX_AGE_S = ONE_YEAR_S;

/** The remembered astronaut if they are still on the crew, else the first; null for an empty crew. */
export function chooseAstronaut(crew: readonly Astronaut[], rememberedId: string | undefined): Astronaut | null {
  return crew.find((astronaut) => astronaut.id === rememberedId) ?? crew[0] ?? null;
}
