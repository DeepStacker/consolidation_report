#!/bin/bash

echo "================================================================================"
echo "🚀 ONE-CLICK HUGGING FACE SPACES DEPLOYER"
echo "================================================================================"
echo ""

# Ensure git is initialized
if [ ! -d .git ]; then
    echo "Initializing Git repository..."
    git init -b main
fi

# Ask for credentials
read -p "👤 Enter Hugging Face Username: " HF_USER
read -p "🌌 Enter Space Name (e.g. excel-consolidation-hub): " HF_SPACE
echo "🔑 Enter your Hugging Face Access Token:"
echo "   (Get it for free at huggingface.co/settings/tokens)"
read -s HF_TOKEN

echo ""
echo "Preparing repository files..."

# Add all tracked files
git add .

# Commit
git commit -m "deploy: web version" 2>/dev/null || echo "Nothing new to commit."

# Setup the authenticated remote URL
REMOTE_URL="https://${HF_USER}:${HF_TOKEN}@huggingface.co/spaces/${HF_USER}/${HF_SPACE}"

# Remove old remote if exists
git remote remove hf 2>/dev/null

# Add new remote
git remote add hf "$REMOTE_URL"

echo ""
echo "Uploading files to Hugging Face Spaces..."
git push -f hf main

if [ $? -eq 0 ]; then
    echo ""
    echo "================================================================================"
    echo "🎉 SUCCESS! Your application is compiling on Hugging Face Spaces."
    echo "👉 Visit: https://huggingface.co/spaces/${HF_USER}/${HF_SPACE}"
    echo "================================================================================"
else
    echo ""
    echo "❌ Error pushing to Hugging Face. Please verify your username, space name, and token."
fi
