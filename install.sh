#!/bin/sh
set -eu
export GIT_TERMINAL_PROMPT=0

agent=auto
install_dir=${BLACKSITE_INSTALL_DIR:-"$HOME/.blacksite"}
ref=main
uninstall=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --agent) agent=${2:?missing agent}; shift 2 ;;
    --dir) install_dir=${2:?missing directory}; shift 2 ;;
    --ref) ref=${2:?missing ref}; shift 2 ;;
    --uninstall) uninstall=1; shift ;;
    --yes) shift ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
done

for tool in node git pnpm; do
  if ! command -v "$tool" >/dev/null 2>&1; then printf 'Install %s, then rerun Blacksite setup.\n' "$tool" >&2; exit 1; fi
done

agents=
if [ "$agent" = auto ]; then
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
for selected in $agents; do node "$install_dir/cli/index.mjs" install --agent "$selected" --global --yes; done
if ! command -v "$cli_name" >/dev/null 2>&1; then printf 'Add this to your shell PATH: export PATH="$HOME/.local/bin:$PATH"\n'; fi
printf '\nBlacksite is ready. Ask your agent anything or run /blacksite:start; it will ask "What would you like to do?"\nOptional asset libraries: blacksite assets login fab, then blacksite assets sync.\n'
