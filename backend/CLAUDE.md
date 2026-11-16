# Backend MANAWA — Principes de développement

## ⚠️ RAPPORTS ARCHIVÉS

Les fichiers dans `docs/archive/backend-reports/` sont des rapports historiques et **ne sont pas des sources de vérité**. 

Seuls le code et les tests font foi.

## Sources de vérité

1. **Code source** — `modules/`, `routes/`, `middleware/`, `config/`
2. **Tests** — `tests/` avec exécution `npm test`
3. **Comportement réel** — pas les commentaires, pas les noms de fichiers

Ne jamais créer de nouveaux rapports. Documenter seulement dans le code.

## Corrections en cours

Pour vérifier une correction:
1. `git diff` pour voir le changement
2. `npm test` pour exécuter les tests
3. Lire les tests pour comprendre ce qui est testé

Un problème n'est résolu que si ses tests passent.
