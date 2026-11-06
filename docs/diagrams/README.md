# Diagram sources and exports

Start with [the written walkthrough](../project-flow.md) or open [the offline HTML presentation](../project-flow.html). The ZIP in `docs/enswhite-diagrams.zip` includes the complete pack.

Edit a `.mmd` file, then render with Mermaid CLI 12.2.0:

```powershell
npx --yes --package @mermaid-js/mermaid-cli@12.2.0 mmdc -i docs/diagrams/01-concept.mmd -o docs/diagrams/01-concept.svg -c docs/diagrams/mermaid-config.json --no-font-embed
npx --yes --package @mermaid-js/mermaid-cli@12.2.0 mmdc -i docs/diagrams/01-concept.mmd -o docs/diagrams/01-concept.png -c docs/diagrams/mermaid-config.json --size 2400
python docs/diagrams/build-guide.py
```

The renderer needs Chromium. If using an existing browser executable, supply a local Puppeteer configuration with `-p`; do not commit personal browser profiles or machine-specific configuration. This does not add a dependency to the application.

The HTML embeds SVGs for offline viewing. PNGs are convenient for slide decks; SVGs are preferable when scaling or editing. The build script checks that all seven SVGs are valid XML and use portable text, then creates the HTML and ZIP.
