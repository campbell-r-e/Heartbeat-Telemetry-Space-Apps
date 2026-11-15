// The six hazard areas shown as dashboard cards and detail pages (SPEC §9.1).

import type { Area } from "@heartbeat/shared";

export interface AreaInfo {
  id: Area;
  title: string;
  /** The short name on the surgeon console's crew chips and the watch dots ("Food" for Nutrition). */
  shortTitle: string;
  /** The hazard / source line under the card title. */
  hazard: string;
  /** The data source named on the detail page. */
  source: string;
  /** Where the dashboard card leads. */
  cardHref: string;
  /** The area's own input page, linked from its detail page. */
  action?: { href: string; text: string };
}

export const DASHBOARD_PATH = "/astronaut";
export const MEAL_PICKER_PATH = `${DASHBOARD_PATH}/meals`;
export const CHECK_IN_PATH = `${DASHBOARD_PATH}/check-in`;

export function detailPath(area: Area): string {
  return `${DASHBOARD_PATH}/${area}`;
}

/** How each area is presented, in the display order of AREAS in @heartbeat/shared. */
export const AREA_INFO: readonly AreaInfo[] = [
  {
    id: "vitals",
    title: "Vitals",
    shortTitle: "Vitals",
    hazard: "Heart · blood · body",
    source: "Galaxy Watch 5 Pro (Samsung Health Sensor SDK) and Astronaut 1's imported watch history",
    cardHref: detailPath("vitals"),
  },
  {
    id: "radiation",
    title: "Radiation",
    shortTitle: "Radiation",
    hazard: "Space radiation · ISS RadLab data",
    source: "NASA RadLab, ISS DosTel2 dosimeter, Aug–Sep 2017 (replayed on the mission clock)",
    cardHref: detailPath("radiation"),
  },
  {
    id: "gravity",
    title: "Gravity",
    shortTitle: "Gravity",
    hazard: "Gravity fields · exercise",
    source: "Mission gravity setting, exercise minutes from watch heart rate, and watch body composition",
    cardHref: detailPath("gravity"),
  },
  {
    id: "cabin",
    title: "Cabin",
    shortTitle: "Cabin",
    hazard: "Hostile closed environment",
    source: "NASA OSDR Environmental Data, ISS mission RR-9, 2018 (replayed) and the watch barometer",
    cardHref: detailPath("cabin"),
  },
  {
    id: "nutrition",
    title: "Nutrition",
    shortTitle: "Food",
    hazard: "Space food log",
    source: "NASA ISS Standard Menu Nutritional Data, with vitamin D from NASA (NTRS 20170001326) or USDA FoodData Central",
    cardHref: MEAL_PICKER_PATH,
    action: { href: MEAL_PICKER_PATH, text: "Log a meal" },
  },
  {
    id: "mind",
    title: "Mind",
    shortTitle: "Mind",
    hazard: "Isolation and confinement",
    source: "Daily mood and stress check-ins and HRV from the watch",
    cardHref: detailPath("mind"),
    action: { href: CHECK_IN_PATH, text: "Mood check-in" },
  },
];

export function findArea(id: string): AreaInfo | undefined {
  return AREA_INFO.find((area) => area.id === id);
}
