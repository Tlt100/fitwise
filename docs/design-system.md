# Design system

The visual language here was derived with the **UI/UX Pro Max** skill
(`nextlevelbuilder/ui-ux-pro-max-skill`), installed project-locally with:

```bash
npx ui-ux-pro-max-cli init --ai claude
```

That writes to `.claude/skills/` inside this project only — no global configuration was
touched. The directory is gitignored because it is a 4.6 MB third-party dependency; run the
command above to restore it.

## What the skill recommended

Querying its dataset for this product type (`--domain product`, `color`, `typography`):

| Decision | Recommendation |
| --- | --- |
| Product archetype | Resume / CV Builder |
| Primary style | Minimalism & Swiss Style + Flat Design |
| Landing pattern | Interactive product demo + CTA |
| Palette focus | Professional navy + section accent + success green + clean white |
| Type | Single-family Swiss (Inter) or Friendly SaaS (Plus Jakarta Sans) |

## What we shipped

**Colour.** The skill's Resume/CV palette, used verbatim as the light-theme primitives:
navy `#1E3A5F` (primary), blue `#2563EB` (secondary/interactive), green `#16A34A` (positive
signal), slate neutrals, `#DC2626` destructive. A dark theme was derived from the same hues,
lightened to hold a 4.5:1 contrast ratio against the dark surfaces — the skill's number one
priority rule is contrast, so every semantic pair was checked rather than eyeballed.

Three colours carry meaning throughout the app and are never used decoratively:

- **green** — evidence found in the resume
- **amber** — present but weakly evidenced
- **red/rose** — no evidence found

The match score arc reuses this same scale, so a colour means the same thing everywhere.

**Type.** Plus Jakarta Sans for headings, Inter for body and UI — both from the skill's
pairing table. Using two related grotesques (rather than the skill's single-family option)
gives the product a voice of its own while staying inside the Swiss idiom. Base size 16px,
body line-height 1.5, nothing below 12px.

**Space.** A 4px base grid exposed as semantic radii and spacing tokens. Containers are
fluid with a max width; no fixed pixel widths, no horizontal scroll at 320px.

**Motion.** Two durations only (`--ease-quick` 150ms for state, `--ease-move` 250ms for
position), both disabled under `prefers-reduced-motion`.

## Tokens

Tokens live in `src/app/globals.css` as three layers: primitive (raw hex) → semantic
(purpose) → Tailwind theme mapping. Components reference semantic names only; a raw hex in a
component is a bug.
