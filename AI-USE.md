# Use of SI (AI) tools

Disclosure for the NASA Space Apps Challenge 2026, which asks teams to identify SI-generated code, data, images and audio.

| Kind | What was SI-assisted | How it is marked |
|---|---|---|
| **Code** | The server, web app, watch app, shared types, tests and scripts were written with an AI coding assistant (Anthropic Claude), working from the team's written spec (`SPEC.md`). The team chose the idea, the features and every design decision, and reviewed and tested every change. | This file, the README's "Use of AI tools" section, and a `siAssisted` field in each `package.json` |
| **Data** | `server/data/astronaut1-history.json` and `server/data/astronaut1-zepp.json` are synthetic sample data, made by a seeded script (`server/scripts/generate-sample-history.ts`) that was written with AI tools. The NASA data files (`radiation-iss.json`, `cabin-iss.json`, `space-food.json`) are downloaded from NASA sources, not generated. | An `si` metadata block and a `source` note inside each generated file, plus this file |
| **Images** | The design mockups in `mockups/` were generated with an AI design assistant. The demo deck's slides were made with AI tools; slides 5–7 are composed around screenshots of the running app. | A visible "SI-generated" / "SI-assisted" watermark on each image and on every slide of the demo deck, and `mockups/README.md` |
| **Documentation** | `SPEC.md`, the READMEs and `docs/` were drafted with AI tools and edited by the team. | This file |
| **Audio** | None. The project has no audio. | Not applicable |
| **Video** | None. The demo is a slide deck. | Not applicable |

The idea for solving the challenge came from the team, not from an AI tool.
