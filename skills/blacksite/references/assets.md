# Assets

Use packs the user already owns from Fab or itch.io through the `blacksite assets` commands, which search an index of metadata and install what the user picks. Assets are optional: a game can ship on procedural geometry, the world kit's CC0 surfaces and synthesized sound.

## Rules

- Use only the CLI's indexed metadata: `blacksite assets list|search|suggest|formats|add`. Credentials stay with the user's terminal and the CLI, which never prints them.
- Never read credential stores or any file whose name contains login, token, secret, key or credential.
- Never copy purchased content into a repository, a public site or a shared example. Purchased assets install into the user's own game and stay out of version control unless the user says otherwise.
- Anything you ship publicly needs a licence that allows redistribution: CC0 is best, CC-BY with credit is fine. Record each one with its source, author and licence.

## With an index

1. `blacksite assets suggest --idea "<idea>" --json` gives the top five per role: characters, environments, models, animations, materials, VFX, audio and UI.
2. `blacksite assets search "<query>" --category <role> --json` narrows a role.
3. Propose one pick at a time, with what it adds to the parts list. Wait for the user's choice.
4. `blacksite assets add <id...> --project <absolute-dir> --json` installs the approved ones and records them in `assets.lock.json`.

Convert what you install to the budget's formats: KTX2 textures and meshopt-compressed glTF (`performance.md`).

## Without one

Plan procedural or purpose-made visuals, CC0 textures and synthesized sound, and name each gap in the design. If the user wants to connect their libraries, ask them to run `blacksite assets login fab|itch|all` and `blacksite assets sync` in their own terminal, then continue with the index. Don't block game work on it.
