# NASA reference documents

Local copies of every NASA document this project relies on, so the team can check a number without hunting for it. The original links are listed beside each file.

## The challenge

| File | What it is | Original |
|---|---|---|
| `Space-Apps-2026-Challenge-Health-Monitoring-Software.pdf` | The challenge page (Details tab) | https://www.spaceappschallenge.org/2026/challenges/health-monitoring-software/?tab=details |
| `NASA-HRP-hazards.pdf` | NASA Human Research Program: the 5 hazards of human spaceflight | https://www.nasa.gov/hrp/hazards/ |
| `NASA-HRP-risks.pdf` | NASA HRP: risks of human spaceflight | https://www.nasa.gov/hrp/risks/ |
| `NASA-HRP-ongoing-hrp-research.pdf` | NASA HRP: ongoing research in space | https://www.nasa.gov/hrp/ongoing-hrp-research/ |

## Health and environment limits (SPEC.md §6.5)

| File | Used for | Original |
|---|---|---|
| `NASA-STD-3001-Vol2-RevF.pdf` | Current standard (approved 2026-07-14): CO₂ [V2 6004], pressure [V2 6006], temperature + humidity zone [V2 6012] Fig. 6.2-2, radiation alerting [V2 6164], noise [V2 6078], [V2 6079], [V2 6115] | https://www.nasa.gov/wp-content/uploads/2025/05/nasa-std-3001-vol-2.pdf |
| `NASA-STD-3001-Vol2-RevA-historical.pdf` | Historical only: the old 18–27 °C range and 25–75% RH requirement | https://standards.nasa.gov/sites/default/files/standards/NASA/B/0/Historical/nasa-std-3001_vol_2_rev_a.pdf |
| `OCHMO-TB-020-Ionizing-Radiation-Protection.pdf` | Career limit 600 mSv [V1 4030], solar event 250 mSv [V1 4031] | https://www.nasa.gov/wp-content/uploads/2023/03/radiation-protection-technical-brief-ochmo.pdf |
| `OCHMO-TB-004-Carbon-Dioxide.pdf` | CO₂ ≤ 3 mmHg 1-hour average; 7-day < 2.5 mmHg headache guidance | https://www.nasa.gov/wp-content/uploads/2023/12/ochmo-tb-004-carbon-dioxide.pdf |
| `OCHMO-TB-003-Habitable-Atmosphere.pdf` | Cabin pressure range; ISS at 14.7 psia | https://www.nasa.gov/wp-content/uploads/2023/12/ochmo-tb-003-habitable-atmosphere.pdf |
| `OCHMO-TB-035-Acoustics.pdf` | Noise requirements overview | https://www.nasa.gov/sites/default/files/atoms/files/acoustics_technical_brief_ochmo_0.pdf |
| `ICES-2024-354-ISS-Acoustics.pdf` | ISS Flight Rule B13-152: sleep stations ≤ 50 dBA | https://ntrs.nasa.gov/api/citations/20240006442/downloads/ICES-2024-354%20ISS%20Acoustics.pdf |
| `ISS-Crewmember-Noise-Exposures-InterNoise2021.pdf` | ISS crew noise exposure context | https://ntrs.nasa.gov/api/citations/20210016305/downloads/Inter-Noise2021_Paper2219_FINAL%20Manuscript.pdf |

## Data sources (not documents; downloaded by scripts)

| Data | Source | Script |
|---|---|---|
| ISS radiation (DosTel2, Aug–Sep 2017) | NASA OSDR RadLab Data API, https://visualization.osdr.nasa.gov/radlab/gui/data-api | `npm run fetch:radlab -w server` |
| ISS cabin CO₂, temperature, humidity (mission RR-9) | NASA OSDR Environmental Data App API, https://visualization.osdr.nasa.gov/eda/api/ | `npm run fetch:eda -w server` |

## Space food nutrition (server/data/space-food.json)

| File | Used for | Original |
|---|---|---|
| `NASA-STEMonstrations-Nutrition-ISS-Standard-Menu.pdf` | Appendix A, "International Space Station Standard Menu Nutritional Data": kcal, protein, sodium, calcium, serving mass and food type for each menu item | https://www.nasa.gov/wp-content/uploads/2023/03/stemonstrations-nutrition.pdf |
| `NASA-Food-and-Nutrition-Updates-from-Space-2017.pdf` | Slide 45: vitamin D (IU) for 15 menu items | https://ntrs.nasa.gov/citations/20170001326 |
| `NASA-Nutrition-Requirements-Exploration-Missions-2005.pdf` | NASA JSC, *Nutrition Requirements, Standards, and Operating Bands for Exploration Missions*, Initial Release rev 1, December 2005 (uploaded to NTRS in 2020, hence the 2020 citation number). Daily nutrition rules (SPEC §6.7): energy Req. 1 p. 14, protein Req. 2 p. 18, vitamin D Req. 8 p. 45, calcium Req. 20 p. 78, sodium Req. 23 p. 34 | https://ntrs.nasa.gov/citations/20200001703 |

Vitamin D values NASA does not publish come from USDA FoodData Central (SR Legacy); each is cited per food in `space-food.json`.
