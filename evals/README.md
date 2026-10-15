# Skill evaluations

Each scenario in `scenarios.json` has Anthropic-style `query` and `expected_behavior` fields. Run it once with the Blacksite plugin installed and once with only the repository URL in the agent prompt. Ask the agent to perform the query in a disposable directory, then inspect its transcript and generated files against each expected behavior. Record pass/fail per item; live runs are deferred for this release.
