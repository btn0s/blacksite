# Blacksite showcases

Each building block has a page at `/tools/<tool>` on the site, and every showcase for that block is embedded on its page. A page can hold several showcases, for example the destruction block will gain micro and meso scenes after Air Strike. Old `/demos/<id>` and `/docs/<block>` URLs redirect to the matching tool page.

Showcases are small game scenes built only on public package exports, the way a game would use them. They share one look from `site/src/look/`: chunky geometry wearing CC0 photographic materials at 512 px, an overcast sky with heavy fog, muted greens, browns and greys, ground AO, a light grade and grain, all set in Soviet industrial ruins. The shared HUD in `site/src/look/hud.tsx` gives each scene a title card, loading meter, keyboard hints and touch controls. Every scene posts frame times to the page's perf overlay. Targets are 120 fps on desktop and 60 fps on phones.

| Block | Showcase | Built on | Status |
| --- | --- | --- | --- |
| Characters | **Checkpoint**: the ALS character runs, vaults and ragdolls through a zone checkpoint. | `als-ue5-r3f` Character and Camera, `@blacksite/subject-fpp/arms` | Live |
| Destruction | **Air Strike**: a Soviet apartment block takes a strike and collapses, seen from a safe vantage. | `@blacksite/cascade` session and renderer | Next |
| Weapons | **Firing range** in the shared look. | `@blacksite/subject-fpp`, `@blacksite/armory` | The older firing range is embedded until then |
| Multiplayer | **Arena** with the loopback split view. | `@blacksite/relay`, `@blacksite/subject` | The older arena is embedded until then |
| AI | **Squad** clearing a courtyard. | `@blacksite/warden`, `@blacksite/warden-react` | The older squad view is embedded until then |
| Input | None yet. | `@blacksite/input`, `@blacksite/ui` | — |

Any downloaded file must be CC0, recorded in `site/public/CREDITS.md`, and compressed before it ships. Purchased or owned assets never appear on the site.
