// "Learn" panel text for each area (SPEC §6.6), with the NASA sources and requirement IDs from
// SPEC §6.5 and docs/nasa/README.md. The prose names what is limited, never the number: the
// limits in force come from the server (decision 17) and are listed beside this text.

import type { Area } from "@heartbeat/shared";

export interface SourceLink {
  label: string;
  url: string;
}

export interface LearnContent {
  whatIsIt: string;
  howMeasured: string;
  whyItMatters: string;
  whenAttention: string;
  /** NASA-STD-3001 requirement IDs and technical briefs this area is checked against. */
  requirements: string[];
  sources: SourceLink[];
}

const HRP_HAZARDS: SourceLink = { label: "NASA: 5 hazards of human spaceflight", url: "https://www.nasa.gov/hrp/hazards/" };
const HRP_RISKS: SourceLink = { label: "NASA HRP: risks of human spaceflight", url: "https://www.nasa.gov/hrp/risks/" };
const STD_3001_VOL2: SourceLink = {
  label: "NASA-STD-3001 Volume 2 Rev F",
  url: "https://www.nasa.gov/wp-content/uploads/2025/05/nasa-std-3001-vol-2.pdf",
};

export const LEARN: Record<Area, LearnContent> = {
  vitals: {
    whatIsIt: "Heart rate, blood oxygen (SpO₂), skin temperature, ECG and heart rate variability: the basic signs of how your body is coping.",
    howMeasured: "The Galaxy Watch reads heart rate continuously. ECG and SpO₂ are on-demand checks: hold a finger on the watch key until the reading finishes. HRV is calculated on the onboard server from beat-to-beat intervals.",
    whyItMatters: "In microgravity, body fluids shift toward the head and the heart works differently. Changes in heart rate or rhythm can be an early sign of stress, dehydration or illness.",
    whenAttention: "NASA-STD-3001 sets no numeric limits for vitals. The rules engine compares readings with standard clinical ranges and, once enough of your own data exists, with your personal baseline.",
    requirements: ["Standard clinical ranges + personal baseline (SPEC §6.2)"],
    sources: [HRP_RISKS, HRP_HAZARDS],
  },
  radiation: {
    whatIsIt: "Energetic particles from the Sun and from outside the solar system. Outside Earth's magnetic field and atmosphere, astronauts receive much more of it than on the ground.",
    howMeasured: "Dosimeters on the spacecraft record the dose rate continuously. This panel replays real ISS DosTel2 data from NASA RadLab, including a real solar particle event.",
    whyItMatters: "Long-term exposure raises cancer risk and can affect the brain, heart and eyes. A sudden solar event can deliver a large dose in hours.",
    whenAttention: "NASA limits the total effective dose over a career and the dose from a single solar particle event. The monitoring system must alert the crew and operations teams when exposure rates exceed predefined thresholds.",
    requirements: ["[V1 4030] career limit", "[V1 4031] solar particle event", "[V2 6164] radiation alerting", "OCHMO-TB-020"],
    sources: [
      { label: "NASA OCHMO-TB-020: Ionizing Radiation Protection", url: "https://www.nasa.gov/wp-content/uploads/2023/03/radiation-protection-technical-brief-ochmo.pdf" },
      { label: "NASA RadLab portal and data API", url: "https://osdr-tutorials.readthedocs.io/en/latest/pages/guides/radlab_portal.html" },
      STD_3001_VOL2,
    ],
  },
  gravity: {
    whatIsIt: "How the mission's gravity (ISS microgravity, the Moon, Mars or Earth) affects bone and muscle.",
    howMeasured: "Exercise minutes are counted each day from the watch's heart rate and compared with the daily goal. The watch can also add skeletal muscle mass from body composition.",
    whyItMatters: "Without gravity loading, astronauts lose bone density and muscle. ISS astronauts exercise every day to slow it. Effects of the Moon's and Mars's partial gravity are not well known.",
    whenAttention: "Exercise counts toward a daily goal set on the onboard server. An exercise minute is one with your heart rate in the moderate-intensity zone for your age.",
    requirements: ["Exercise minutes (SPEC §5.4)"],
    sources: [HRP_HAZARDS, HRP_RISKS],
  },
  cabin: {
    whatIsIt: "The air you live in: carbon dioxide, temperature, humidity, pressure and noise inside a closed spacecraft.",
    howMeasured: "Station sensors record CO₂, temperature and humidity (replayed here from NASA OSDR data, ISS mission RR-9). The watch barometer measures cabin pressure.",
    whyItMatters: "CO₂ builds up without Earth's air circulation and can cause headaches and poor focus. Temperature, humidity, pressure and noise all affect health and sleep.",
    whenAttention: "NASA limits the hourly average CO₂ and recommends a lower weekly average to avoid headaches. Pressure must stay inside a safe range, and temperature and humidity must sit together inside NASA's comfort zone.",
    requirements: ["[V2 6004] CO₂", "[V2 6006] pressure", "[V2 6012] temperature + humidity", "[V2 6078] [V2 6079] [V2 6115] noise", "OCHMO-TB-003", "OCHMO-TB-004"],
    sources: [
      { label: "NASA OCHMO-TB-004: Carbon Dioxide", url: "https://www.nasa.gov/wp-content/uploads/2023/12/ochmo-tb-004-carbon-dioxide.pdf" },
      { label: "NASA OCHMO-TB-003: Habitable Atmosphere", url: "https://www.nasa.gov/wp-content/uploads/2023/12/ochmo-tb-003-habitable-atmosphere.pdf" },
      STD_3001_VOL2,
    ],
  },
  nutrition: {
    whatIsIt: "What you eat from the space food menu, totaled for calories, protein, calcium, vitamin D and sodium.",
    howMeasured: "Pick each meal from the menu. Values come from NASA's ISS Standard Menu Nutritional Data; vitamin D comes from NASA where it is listed, otherwise from USDA FoodData Central.",
    whyItMatters: "Eating enough keeps up energy and muscle. Calcium and vitamin D help slow bone loss in microgravity, and too much sodium adds to bone loss.",
    whenAttention: "Each nutrient has a daily target band from NASA's nutrition requirements, set on the onboard server. Today's running totals are shown against it; the rules engine rates each completed day.",
    requirements: ["ISS Standard Menu Nutritional Data", "NTRS 20170001326 (vitamin D)"],
    sources: [
      { label: "NASA: ISS Standard Menu Nutritional Data", url: "https://www.nasa.gov/wp-content/uploads/2023/03/stemonstrations-nutrition.pdf" },
      { label: "NASA Food & Nutrition: Updates from Space (2017)", url: "https://ntrs.nasa.gov/citations/20170001326" },
    ],
  },
  mind: {
    whatIsIt: "Your mood and stress, tracked by a daily check-in and by heart rate variability (HRV), a stress marker from the watch.",
    howMeasured: "Each evening, rate your mood and stress on the dashboard or the watch. HRV is calculated from the watch's beat-to-beat intervals. Each night's sleep is detected by the onboard server from how still the wrist is (the watch's motion sensor, van Hees et al. 2018) and shown in hours.",
    whyItMatters: "Isolation, confinement, noise and a shifted light/dark cycle commonly disrupt sleep and mood on long missions.",
    whenAttention: "The rules engine combines several signals: several nights of short sleep with low mood and reduced HRV point to a possible behavioral health concern.",
    requirements: ["Combination rule: behavioral health (SPEC §6.4)"],
    sources: [HRP_HAZARDS, HRP_RISKS],
  },
};
