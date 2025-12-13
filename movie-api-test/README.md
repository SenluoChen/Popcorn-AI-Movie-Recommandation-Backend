# movie-api-test – Générateur & Recherche de Vecteurs de Films

Ce dossier contient un projet Node.js permettant de :
- Récupérer des données de films depuis OMDb / TMDb / Wikipedia
- Utiliser OpenAI pour générer (1) une description enrichie, (2) des tags d'ambiance/émotion, (3) des vecteurs d'embedding
- Écrire les résultats dans `movie-vectors/movie_data.json` pour la recherche sémantique

## Prérequis
- Node.js 18+
- Clés API requises (voir `.env.example`)

## Installation

1) Installer les dépendances

```bash
cd movie-api-test
npm install
```

2) Configurer les variables d'environnement

Copiez `.env.example` en `.env` et renseignez vos clés API.

## Commandes

- Construire/mettre à jour la base de vecteurs (à partir de `movie-vectors/movie_titles.json`)

```bash
node fetchMovie.js build
```

- Construire/mettre à jour des films spécifiques

```bash
node fetchMovie.js build "The Matrix" "Inception"
```

- Recherche interactive (utilise le fichier déjà généré `movie-vectors/movie_data.json`)

```bash
node fetchMovie.js search
```

## Fichiers
- `movie-vectors/movie_titles.json` : Liste des titres de films à traiter en batch (à committer de préférence)
- `movie-vectors/movie_data.json` : Base de données générée (par défaut non commitée ; déjà ignorée dans `.gitignore` du repo)

## Remarques
- `TMDB_API_KEY` est optionnelle : si absente, l'enrichissement TMDb (acteurs/mots-clés/genres) sera ignoré.
- La commande `search` utilise OpenAI pour transformer la requête en embedding (ne récupère pas de nouvelles données films lors de la recherche).
