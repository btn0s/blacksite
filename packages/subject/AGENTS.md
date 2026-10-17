# Subject

Purpose: the one Character Controller for every character game, built on the ALS character (`DESIGN.md`). `createCharacterController({ views })` makes the handle; `<CharacterController controller>` mounts the body, camera and arms inside `<Physics>`; `CharacterOverlay` draws touch controls and device prompts. The controller's pause releases input and reports `paused`; the session owns time, and `useLocalSession` stops the frame loop and its `now()` for single player.

For ALS third person or a switchable view, `@blacksite/subject` exports `createSubject`, `Subject`, and `FPS_WEAPONS`; focused `/controller` and `/Subject` imports remain. Mount `Subject` with an ALS Character input bridge. The controller frame provides aim and muzzle data to Armory. Keep one owner for camera mode and input edges. Multiplayer replication and server authority belong to the game protocol and transport seam.
