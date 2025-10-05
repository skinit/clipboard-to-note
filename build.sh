#!/bin/bash

# Build script for Clipboard to Note Obsidian plugin

echo "Building Clipboard to Note plugin..."

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Run the build
echo "Running TypeScript compilation and bundling..."
npm run build

# Check if build was successful
if [ $? -eq 0 ]; then
    echo "✓ Build completed successfully!"
    echo "Output files:"
    echo "  - main.js"
    echo "  - manifest.json"
    echo "  - styles.css (if exists)"
else
    echo "✗ Build failed!"
    exit 1
fi
