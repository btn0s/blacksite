# Game work

Use the stack skill for engine and game setup. Keep gameplay rules in this game and shared systems in Blacksite or ALS. Koota holds entities and data; XState holds discrete phases; Effect holds services and lifetimes. The server owns damage and match state; the client owns immediate movement. Run `pnpm check` before commit and playtest gameplay changes. Keep purchased assets in ignored local directories. Promote proven shared changes into the skill.
