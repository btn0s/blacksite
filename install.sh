#!/bin/sh
set -eu
export GIT_TERMINAL_PROMPT=0

usage='Usage: install.sh [--agent claude|codex|cursor|auto] [--skip-agents] [--dir <dir>] [--ref <ref>] [--uninstall]
  --agent        register the Blacksite skill with one agent (default: every agent found)
  --skip-agents  set up only the CLI, packages and templates; register the skill with no agent
                 (use this when the skill came from skills.sh)'

agent=auto
agent_set=0
skip_agents=0
install_dir=${BLACKSITE_INSTALL_DIR:-"$HOME/.blacksite"}
ref=main
uninstall=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --agent) agent=${2:?missing agent}; agent_set=1; shift 2 ;;
    --skip-agents) skip_agents=1; shift ;;
    -h|--help) printf '%s\n' "$usage"; exit 0 ;;
    --dir) install_dir=${2:?missing directory}; shift 2 ;;
    --ref) ref=${2:?missing ref}; shift 2 ;;
    --uninstall) uninstall=1; shift ;;
    --yes) shift ;;
    *) printf 'Unknown option: %s\n%s\n' "$1" "$usage" >&2; exit 2 ;;
  esac
done

for tool in node git pnpm; do
  if ! command -v "$tool" >/dev/null 2>&1; then printf 'Install %s, then rerun Blacksite setup.\n' "$tool" >&2; exit 1; fi
done

if [ "$skip_agents" -eq 1 ] && [ "$agent_set" -eq 1 ]; then printf 'Choose --agent or --skip-agents, not both.\n' >&2; exit 2; fi
if [ "$agent_set" -eq 0 ] && [ -f "$install_dir/.git/blacksite-skip-agents" ]; then skip_agents=1; fi

agents=
if [ "$skip_agents" -eq 1 ]; then
  :
elif [ "$agent" = auto ]; then
  for candidate in claude codex cursor; do
    if command -v "$candidate" >/dev/null 2>&1; then agents="$agents $candidate"; fi
  done
  if [ -z "$agents" ]; then agents=' codex'; fi
else
  case "$agent" in claude|codex|cursor) agents=" $agent" ;; *) printf 'Choose --agent claude|codex|cursor|auto\n' >&2; exit 2 ;; esac
fi

cli_name=blacksite
if [ -f "$install_dir/product.json" ]; then cli_name=$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).cli' "$install_dir/product.json"); fi

if [ "$uninstall" -eq 1 ]; then
  if [ -f "$install_dir/cli/index.mjs" ]; then
    for selected in $agents; do node "$install_dir/cli/index.mjs" install --agent "$selected" --global --uninstall --yes; done
  fi
  if [ -L "$HOME/.local/bin/$cli_name" ]; then rm "$HOME/.local/bin/$cli_name"; fi
  if [ -f "$install_dir/.git/blacksite-installed" ]; then
    rm -rf "$install_dir"
  elif [ -d "$install_dir/.git" ]; then
    printf 'Checkout was not created by this installer; remove it manually: %s\n' "$install_dir"
  fi
  printf 'Blacksite setup removed.\n'
  exit 0
fi

source_repo=${BLACKSITE_SOURCE:-https://github.com/btn0s/blacksite.git}
if [ -d "$install_dir/.git" ]; then
  if [ -n "$(git -C "$install_dir" status --porcelain)" ]; then printf 'Blacksite checkout has local edits: %s\n' "$install_dir" >&2; exit 1; fi
  git -C "$install_dir" fetch --depth 1 origin "$ref"
  git -C "$install_dir" checkout --detach FETCH_HEAD
  git -C "$install_dir" submodule update --init --recursive
elif [ -e "$install_dir" ]; then
  printf 'Install directory exists and is not a Git checkout: %s\n' "$install_dir" >&2
  exit 1
else
  git clone --recursive --depth 1 "$source_repo" "$install_dir"
  : > "$install_dir/.git/blacksite-installed"
  if [ "$ref" != main ]; then
    git -C "$install_dir" fetch --depth 1 origin "$ref"
    git -C "$install_dir" checkout --detach FETCH_HEAD
    git -C "$install_dir" submodule update --init --recursive
  fi
fi

cli_name=$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).cli' "$install_dir/product.json")
(cd "$install_dir" && pnpm install --frozen-lockfile)

mkdir -p "$HOME/.local/bin"
ln -sfn "$install_dir/cli/index.mjs" "$HOME/.local/bin/$cli_name"
if [ "$skip_agents" -eq 1 ]; then : > "$install_dir/.git/blacksite-skip-agents"; else rm -f "$install_dir/.git/blacksite-skip-agents"; fi
for selected in $agents; do node "$install_dir/cli/index.mjs" install --agent "$selected" --global --yes; done
if ! command -v "$cli_name" >/dev/null 2>&1; then printf 'Add this to your shell PATH: export PATH="$HOME/.local/bin:$PATH"\n'; fi
printf '\nBlacksite is ready.\n'
if [ "$skip_agents" -eq 1 ]; then printf 'No agent was changed: the skill is already installed through skills.sh. Ask your agent for a game.\n'; fi
for selected in $agents; do
  case "$selected" in
    claude) printf 'Claude Code: ask for a game, or run /blacksite:blacksite <your idea>.\n' ;;
    codex) printf 'Codex: ask for a game; the skill is in ~/.agents/skills/blacksite.\n' ;;
    cursor) printf 'Cursor: ask for a game; the skill is in ~/.cursor/skills/blacksite.\n' ;;
  esac
done
printf 'Optional asset libraries: blacksite assets login fab, then blacksite assets sync.\n'
