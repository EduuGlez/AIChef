#!/bin/sh
set -eu

if [ "$(git branch --show-current)" != "main" ]; then
  echo "Error: el despliegue debe ejecutarse desde la rama main." >&2
  exit 1
fi

if [ ! -f .env ]; then
  echo "Error: falta .env. Cópialo desde .env.example antes de desplegar." >&2
  exit 1
fi

git pull --ff-only origin main
docker compose pull ollama ollama-init
docker compose up -d --build --remove-orphans
docker compose ps
