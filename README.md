# Révise

Application de révision : colle un cours, obtiens des **flashcards**, une **fiche de révision** et un **quiz** générés par Claude.

- Page unique : `index.html` (HTML/CSS/JS sans dépendance, hors polices Google Fonts).
- Publiée comme artefact Claude : https://claude.ai/artifact/JR7paf7oXW9WPu95tjyJDE

## Fonctionnement

- **Cours** : coller du texte ou importer un fichier **PDF**, `.txt` ou `.md`. Le texte des PDF est extrait dans le navigateur avec [pdf.js](https://github.com/mozilla/pdf.js) (hébergé dans `vendor/pdfjs/`, chargé seulement quand on importe un PDF). Les PDF scannés (images sans texte) ne sont pas pris en charge.
- **Flashcards** : 15 à 25 cartes, révision espacée (intervalles de 1, 3, 7, 14 jours).
- **Fiche** : résumé, sections de points clés, lexique.
- **Quiz** : QCM de 8 à 12 questions avec explications et score.

## Installer sur téléphone (GitHub Pages)

Version en ligne : https://thomas24000.github.io/R-visio/

- **iPhone (Safari)** : Partager → « Sur l'écran d'accueil ».
- **Android (Chrome)** : menu ⋮ → « Ajouter à l'écran d'accueil » / « Installer l'application ».

L'app a une icône (`icons/`), un manifeste (`manifest.webmanifest`) et un service worker (`sw.js`) qui la rend utilisable **hors ligne** après la première visite.

### Mises à jour

- Il suffit de pousser sur `main` : pas de numéro de version à changer.
- L'app charge toujours la dernière version publiée dès qu'il y a du réseau (le cache ne sert que hors ligne).
- Si l'app est déjà ouverte, elle vérifie s'il y a du nouveau à chaque retour dans l'appli, au retour du réseau et toutes les 5 minutes, puis affiche une bannière « Nouvelle version disponible → Mettre à jour ».
- En bas de l'accueil : numéro de version (`APP_VERSION` dans `index.html`, à incrémenter à chaque modif) et bouton « Forcer la mise à jour » qui vide le cache de l'appli et recharge (les cours ne sont pas effacés).
- Ne changer `VERSION` dans `sw.js` que si la liste des fichiers en cache ou la logique du service worker change.

## IA locale (expérimental)

Sur la version GitHub Pages, la génération se fait avec un petit modèle d'IA qui tourne **dans le navigateur** (`ia-locale.js`) :

- Moteur : [wllama](https://github.com/ngxson/wllama) 3.13.0 (llama.cpp en WebAssembly), hébergé dans `vendor/wllama/`. WebGPU si disponible, sinon processeur.
- Safari / iOS : build de compatibilité `vendor/wllama-compat/` (Safari n'a ni JSPI ni Memory64).
- Modèles (téléchargés une fois depuis Hugging Face, puis gardés en cache → hors ligne) :
  - **Léger** : Qwen 2.5 0,5B Instruct Q4_K_M (≈ 400 Mo)
  - **Équilibré** : Qwen 2.5 1,5B Instruct Q4_K_M (≈ 1,1 Go)
- Sortie contrainte par des grammaires GBNF (JSON toujours au bon format) et lecture tolérante si la sortie est coupée.
- Le cours est découpé en extraits d'environ 3 500 caractères (4 extraits au maximum, répartis sur tout le cours).
- Qualité nettement inférieure à Claude : à relire. Dans l'artefact claude.ai, c'est Claude qui génère.
- Le modèle se supprime depuis le bas de l'accueil (« IA locale : … · Supprimer »).

## Limites actuelles

- Les données sont stockées dans le `localStorage` du navigateur (pas de synchronisation entre appareils).
- La génération utilise la capacité `sample` du runtime des artefacts Claude (`claude.use("sample")`) : elle ne fonctionne que dans l'artefact ouvert depuis un compte Claude, pas en ouvrant `index.html` en local.
