#!/usr/bin/env bash
#
# green-graph.sh — paint the GitHub contribution graph for user "defenestrator"
# solid green with a negative-space smiley in the center.
#
# HOW IT WORKS
#   The contribution graph is a 7-row (Sun..Sat) x 53-column (week) grid keyed by
#   commit AUTHOR date. This script makes backdated empty commits in a dedicated
#   repo: every day in the trailing 53 weeks gets COMMITS_PER_DAY commits (solid
#   green) EXCEPT the cells that spell out a smiley, which get zero commits (the
#   negative space). Contributions only appear once the repo is pushed to GitHub
#   under an email verified on your account.
#
# SAFETY / NOTES
#   - Uses a NEW, dedicated repo ($REPO_DIR). It does not touch any real project.
#   - Empty commits (--allow-empty): no files, tiny repo, still counts.
#   - AUTHOR_EMAIL must be a verified email on the "defenestrator" account or the
#     commits won't be attributed to you. Default is your noreply address.
#   - Pushing is what changes the PUBLIC graph. It is gated behind DO_PUSH=1.
#     A public repo always counts; a private repo counts only if your profile has
#     "Private contributions" enabled.
#   - Fully reversible: delete the GitHub repo to remove every contribution.
#   - Targets macOS/BSD `date` (this machine). Linux `date` differs.
#
# USAGE
#   ./green-graph.sh            # dry run: prints the ASCII preview only, no commits
#   ./green-graph.sh --commit   # create the backdated commits locally
#   DO_PUSH=1 ./green-graph.sh --commit   # also create the GH repo and push (PUBLISHES)
#
set -euo pipefail

# ---- Config -----------------------------------------------------------------
REPO_DIR="${REPO_DIR:-$HOME/green-graph}"
GH_REPO_NAME="${GH_REPO_NAME:-green-graph}"      # repo name to create on push
AUTHOR_NAME="${AUTHOR_NAME:-Jeremy Jacob Anderson}"
AUTHOR_EMAIL="${AUTHOR_EMAIL:-529446+defenestrator@users.noreply.github.com}"
COMMITS_PER_DAY="${COMMITS_PER_DAY:-10}"          # >0; uniform count => uniform shade
WEEKS=53                                          # graph width (columns)
COMMIT_HOUR="12:00:00"                            # noon avoids timezone edge days
DO_PUSH="${DO_PUSH:-0}"                            # 1 = create GH repo + push

# Smiley stamp: 7 rows (Sun..Sat) x 13 cols. 1 = green, 0 = hole (negative space).
# Edit freely — width is taken from row 0; it is centered in the 53-week grid.
STAMP=(
  "1111111111111"
  "1110011100111"
  "1110011100111"
  "1111111111111"
  "1101111111011"
  "1110111110111"
  "1111100000111"
)
STAMP_W=${#STAMP[0]}
STAMP_START=$(( (WEEKS - STAMP_W) / 2 ))

MODE="${1:-}"

# ---- Helpers ----------------------------------------------------------------
# Is cell (col,day) green? day: 0=Sun..6=Sat. Default green; smiley cells = hole.
is_green() {
  local col=$1 day=$2 rel ch
  rel=$(( col - STAMP_START ))
  if (( rel >= 0 && rel < STAMP_W )); then
    ch="${STAMP[$day]:$rel:1}"
    [[ "$ch" == "0" ]] && return 1
  fi
  return 0
}

# Day offset (days before today) for the leftmost Sunday of the grid.
DOW=$(date +%w)                       # 0=Sun..6=Sat (today)
BASE_BACK=$(( DOW + (WEEKS - 1) * 7 )) # today -> leftmost Sunday

# ---- ASCII preview ----------------------------------------------------------
echo "Preview ('#' = green, ' ' = empty). Rows Sun..Sat, $WEEKS weeks:"
for day in 0 1 2 3 4 5 6; do
  row=""
  for (( col=0; col<WEEKS; col++ )); do
    i=$(( col * 7 + day ))
    off=$(( BASE_BACK - i ))
    if (( off < 0 )); then row+=" "; continue; fi   # future cell, blank
    if is_green "$col" "$day"; then row+="#"; else row+=" "; fi
  done
  printf '  %s\n' "$row"
done
echo

if [[ "$MODE" != "--commit" ]]; then
  echo "Dry run. Re-run with --commit to create the backdated commits."
  exit 0
fi

# ---- Make commits -----------------------------------------------------------
mkdir -p "$REPO_DIR"
cd "$REPO_DIR"
if [[ ! -d .git ]]; then
  git init -q -b main
fi
git config user.name  "$AUTHOR_NAME"
git config user.email "$AUTHOR_EMAIL"

total=0
for (( col=0; col<WEEKS; col++ )); do
  for day in 0 1 2 3 4 5 6; do
    i=$(( col * 7 + day ))
    off=$(( BASE_BACK - i ))
    (( off < 0 )) && continue
    is_green "$col" "$day" || continue
    D=$(date -v-"${off}"d +%Y-%m-%d)
    stamp="${D}T${COMMIT_HOUR}"
    for (( c=0; c<COMMITS_PER_DAY; c++ )); do
      GIT_AUTHOR_DATE="$stamp"   GIT_AUTHOR_NAME="$AUTHOR_NAME"   GIT_AUTHOR_EMAIL="$AUTHOR_EMAIL" \
      GIT_COMMITTER_DATE="$stamp" GIT_COMMITTER_NAME="$AUTHOR_NAME" GIT_COMMITTER_EMAIL="$AUTHOR_EMAIL" \
        git commit -q --allow-empty -m "green $D #$c"
      total=$(( total + 1 ))
    done
  done
done
echo "Created $total backdated commits in $REPO_DIR"

# ---- Optional publish -------------------------------------------------------
if [[ "$DO_PUSH" == "1" ]]; then
  echo "Publishing to GitHub (this changes your public graph)..."
  if ! git remote get-url origin >/dev/null 2>&1; then
    gh repo create "$GH_REPO_NAME" --public --source=. --remote=origin
  fi
  git push -u origin main --force
  echo "Pushed. Allow a few minutes for the graph to update."
else
  echo "Not pushed (DO_PUSH != 1). To publish:"
  echo "  cd $REPO_DIR && gh repo create $GH_REPO_NAME --public --source=. --remote=origin && git push -u origin main --force"
fi
