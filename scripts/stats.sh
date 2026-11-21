#!/bin/sh
# BolBeats repo stats: DMG downloads per release, and the last 14 days of GitHub traffic (visits, unique visitors,
# clones, where visitors came from). Traffic needs the GitHub CLI signed in as someone with push access to the repo.
# Usage: sh scripts/stats.sh [owner/repo]
REPO="${1:-itsrocksome/bolbeats}"

echo "Downloads (all time)"
gh api "repos/$REPO/releases" --paginate --jq '.[] | .tag_name as $t | .assets[] | "  \($t)  \(.name): \(.download_count)"'
gh api "repos/$REPO/releases" --paginate --jq '[.[].assets[].download_count] | add | "  total: \(. // 0)"'

echo "Visits, last 14 days"
gh api "repos/$REPO/traffic/views" --jq '"  views: \(.count), unique visitors: \(.uniques)"'
gh api "repos/$REPO/traffic/clones" --jq '"  clones: \(.count), unique cloners: \(.uniques)"'

echo "Where visitors came from"
gh api "repos/$REPO/traffic/popular/referrers" --jq '.[] | "  \(.referrer): \(.count) views, \(.uniques) people"'

echo "Stars: $(gh api "repos/$REPO" --jq .stargazers_count)"
echo "Daily visitor graph: https://hits.sh/github.com/$REPO/"
