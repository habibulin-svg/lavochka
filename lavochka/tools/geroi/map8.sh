#!/bin/bash
# Матрица фракций карты на 8 наборах сидов параллельно (по 24 партии на пару), среднее и разброс: bash tools/geroi/map8.sh (~3 мин на 6 ядрах)
export PATH="/c/Program Files/nodejs:$PATH"
cd "$(dirname "$0")/../.."
out=$(for b in 0 10000 20000 30000 40000 50000 90000 130000; do npx tsx tools/geroi/mapbalance.ts 24 s duel factions $b | grep "побед" & done; wait)
echo "$out" | awk '{gsub(":","",$1); s[$1]+=$2; n[$1]++; v[$1]=v[$1]" "$2} END {for (f in s) printf "%s %.0f (%s)\n", f, s[f]/n[f], v[f]}' | sort
