---
name: start
description: Start Blacksite with one question and route to the right task.
disable-model-invocation: true
---

# Start

Ask exactly one question: **What would you like to do?** Offer: make a new game from an idea; continue an existing game; build or combine prototypes; optimize; ship; connect asset libraries (optional); learn the kit. Wait for a choice. Done when the user chooses one path.

For a new game, Call the Skill tool with "make-game". For an existing game, inspect its design and Call the Skill tool with "setup-project" or "build-prototype". For prototypes, Call the Skill tool with "build-prototype" or "combine-prototypes". For optimization, Call the Skill tool with "optimize-game". For shipping, Call the Skill tool with "ship-game". For optional libraries, Call the Skill tool with "game-assets". For kit orientation, Call the Skill tool with "blacksite-kit". Done when the selected skill starts.
