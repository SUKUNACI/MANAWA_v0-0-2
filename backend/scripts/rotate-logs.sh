#!/bin/bash
# Rotation et nettoyage logs MANAWA — Exécuter via cron quotidien
# Usage: ./scripts/rotate-logs.sh

set -e

LOG_DIR="${LOG_DIR:=$(dirname "$0")/../logs}"
MAX_SIZE_MB="${MAX_SIZE_MB:=100}"
KEEP_DAYS="${KEEP_DAYS:=7}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

echo "[$(date)] === Rotation logs MANAWA ==="
echo "Répertoire: $LOG_DIR"
echo "Taille max: ${MAX_SIZE_MB}MB"
echo "Rétention: ${KEEP_DAYS} jours"

if [ ! -d "$LOG_DIR" ]; then
  echo "[$(date)] Répertoire logs non trouvé: $LOG_DIR"
  exit 0
fi

# Nettoyer les fichiers logs vieux
echo "[$(date)] Suppression logs > ${KEEP_DAYS} jours..."
find "$LOG_DIR" -type f -name "*.log*" -mtime +$KEEP_DAYS -exec rm -v {} \; 2>/dev/null || true

# Roter fichiers trop gros
echo "[$(date)] Vérification taille fichiers logs..."
for logfile in "$LOG_DIR"/*.log; do
  if [ ! -f "$logfile" ]; then
    continue
  fi

  size_bytes=$(stat -c%s "$logfile" 2>/dev/null || stat -f%z "$logfile" 2>/dev/null || echo 0)
  size_mb=$(( size_bytes / 1024 / 1024 ))

  if [ $size_mb -gt $MAX_SIZE_MB ]; then
    echo "[$(date)] Rotation $logfile (${size_mb}MB)"

    # Renommer le fichier avec timestamp
    rotated_file="${logfile}.${TIMESTAMP}"
    mv "$logfile" "$rotated_file"

    # Compresser
    if command -v gzip &> /dev/null; then
      gzip "$rotated_file"
      echo "[$(date)] Compressé: ${rotated_file}.gz"
    fi

    # Créer nouveau fichier vide
    touch "$logfile"
  fi
done

# Résumé
echo "[$(date)] Rotation terminée"
du -sh "$LOG_DIR" 2>/dev/null | xargs echo "Taille répertoire logs:" || true
echo "[$(date)] === FIN ==="
