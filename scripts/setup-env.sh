#!/usr/bin/env bash

# This script sets up the monorepo for development by:
#   - Creating a '.env' file (if needed)
#   - Symlinking it in all the 'apps' directories
#
# This runs automatically on postinstall.
# This simplifies working with the repo a lot.

set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
ENV_EXAMPLE="$ROOT_DIR/.env.example"

# Create .env from .env.example if it doesn't exist
if [ ! -f "$ENV_FILE" ]; then
  echo "Creating .env from .env.example..."
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  echo "✓ Created .env file"
else
  echo "✓ .env file already exists"
fi

# Create symlinks in all apps
echo "Creating .env symlinks in apps..."
for app_dir in "$ROOT_DIR"/apps/*/; do
  if [ -d "$app_dir" ]; then
    app_name=$(basename "$app_dir")
    app_env="$app_dir/.env"

    # Remove existing symlink or file
    if [ -L "$app_env" ]; then
      rm "$app_env"
    elif [ -f "$app_env" ]; then
      echo "Warning: $app_name/.env exists as a regular file. Skipping to avoid data loss."
      echo "         Remove it manually if you want to use the symlink."
      continue
    fi

    # Create symlink (relative path)
    ln -s "../../.env" "$app_env"
    echo "✓ Created symlink in $app_name"
  fi
done

echo "✓ Environment setup complete"
