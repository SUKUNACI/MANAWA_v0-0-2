# Backend MANAWA — Principes de développement

## Règles de travail pour les corrections

1. **Examen du code réel** — Lire les fichiers source (`modules/`, `routes/`, `middleware/`), ne pas se fier aux rapports, commentaires ou noms de fichiers.

2. **Vérification complète** — Ne marquer aucun défaut comme corrigé sans avoir exécuté les tests et vérifié le code modifié.

3. **Chemin complet** — Pour chaque défaut, tracer: route → middleware → module métier → données → effets externes.

4. **Corrections à la source** — Pas de contournements qui laissent le défaut accessible ailleurs.

5. **Tests obligatoires** — Un test qui ÉCHOUE avant le correctif, puis PASSE après. Cas autorisés ET interdits.

6. **Un commit par défaut** — Après chaque correction vérifiée, commit avec message `fix(security): <point>`.

7. **Pas de simulation** — Pas de fake succès de paiement, pas de simulation Redis, pas de modification de tests existants pour les faire passer.

8. **Limites de contexte** — Si le contexte est plein, arrêter proprement après un commit et signaler ce qui reste.

9. **Blocages absolu** — Si un service externe (GeniusPay, Mailjet, DB) empêche la vérification, signaler exactement ce qui manque, pas "à faire".

10. **Rapports archivés** — Les fichiers dans `docs/archive/backend-reports/` ne sont pas des sources de vérité. Seuls le code et les tests font foi.
