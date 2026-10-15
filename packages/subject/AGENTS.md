# Subject

Purpose: player input and camera intent. For single-player first person, use the separate `@blacksite/subject-fpp` package. It has no ALS runtime dependency and mounts an arms-only controller.

For ALS third person or a switchable view, `@blacksite/subject` exports `createSubject`, `Subject`, and `FPS_WEAPONS`; focused `/controller` and `/Subject` imports remain. Mount `Subject` with an ALS Character input bridge. The controller frame provides aim and muzzle data to Armory. Keep one owner for camera mode and input edges. Multiplayer replication and server authority belong to the game protocol and transport seam.
