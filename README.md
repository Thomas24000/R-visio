# Révise

Application de révision : colle un cours, obtiens des **flashcards**, une **fiche de révision** et un **quiz** générés par Claude.

- Page unique : `index.html` (HTML/CSS/JS sans dépendance, hors polices Google Fonts).
- Publiée comme artefact Claude : https://claude.ai/artifact/JR7paf7oXW9WPu95tjyJDE

## Fonctionnement

- **Cours** : coller du texte ou importer un fichier `.txt` / `.md`.
- **Flashcards** : 15 à 25 cartes, révision espacée (intervalles de 1, 3, 7, 14 jours).
- **Fiche** : résumé, sections de points clés, lexique.
- **Quiz** : QCM de 8 à 12 questions avec explications et score.

## Installer sur téléphone (GitHub Pages)

Version en ligne : https://thomas24000.github.io/R-visio/

- **iPhone (Safari)** : Partager → « Sur l'écran d'accueil ».
- **Android (Chrome)** : menu ⋮ → « Ajouter à l'écran d'accueil » / « Installer l'application ».

L'app a une icône (`icons/`), un manifeste (`manifest.webmanifest`) et un service worker (`sw.js`) qui la rend utilisable **hors ligne** après la première visite. À chaque modification des fichiers, incrémenter `VERSION` dans `sw.js`.

## Limites actuelles

- Les données sont stockées dans le `localStorage` du navigateur (pas de synchronisation entre appareils).
- La génération utilise la capacité `sample` du runtime des artefacts Claude (`claude.use("sample")`) : elle ne fonctionne que dans l'artefact ouvert depuis un compte Claude, pas en ouvrant `index.html` en local.
