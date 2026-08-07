# Shopify app development

This app is scaffolded from a Shopify app template. See the README for framework-specific details.

Use the [Shopify AI Toolkit](https://shopify.dev/docs/apps/build/ai-toolkit) for all Shopify API and platform work. If missing, install it in the agent host per that page (or `npx skills add Shopify/shopify-ai-toolkit --list` for skill-compatible hosts) — do not add tooling to this repo.

## Polaris-only UI (hard constraint — App Store compliance)

**Every screen under `embedded/` must use only Polaris components, Polaris design tokens, and Polaris CSS custom properties (`--p-*`).**

This is a compliance requirement, not a style preference. Full Polaris adoption is intentional to avoid App Store rejection for non-Polaris UI.

### Allowed

- Components and primitives from `@shopify/polaris` (and App Bridge React where required for embedding)
- Polaris props that map to design tokens (`tone`, `variant`, `gap`, `padding`, `background`, `borderColor`, etc.)
- Composing Polaris primitives for patterns Polaris does not ship as a single component (e.g. workflow timeline from `Badge` + `Text` + `ProgressBar` + `BlockStack`)

### Forbidden

- Custom CSS / CSS modules / styled-components / Tailwind for app UI
- Custom colors, fonts, shadows, radii, or spacing values outside Polaris tokens
- Hand-built markup/styling that is not composed from Polaris primitives
- Inline `style={{...}}` with raw CSS values (use Polaris `Box` / layout props instead)

### When Polaris has no component

1. Compose the closest Polaris primitives, **or**
2. **Stop and flag the gap to the human** — do not invent custom UI to fill it.

If unsure whether something is still Polaris-compliant, ask rather than guessing.
