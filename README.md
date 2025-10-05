# Clipboard to Note - Obsidian Plugin

An Obsidian plugin that processes clipboard text and URLs with AI-powered tag suggestions, web clipping capabilities, and intelligent image downloading.

## Features

### Core Functionality
- **One-click note creation** from clipboard content (text or URLs)
- **AI-powered tag suggestions** based on your vault's folder structure
- **Automatic title generation** from clipboard text
- **Smart markdown formatting** (converts H1 to H2, maintains header hierarchy)
- **YAML frontmatter** with tags, created, and modified timestamps
- **Configurable inbox folder** for new notes
- **Multilingual support** (German/English)

### Web Clipping
- **URL detection** - Automatically detects when clipboard contains a URL
- **HTML to Markdown conversion** - Downloads and converts web pages using Turndown with GFM support
- **Image downloading** - Optionally downloads all images from web pages
- **Relative URL resolution** - Converts all relative image URLs to absolute URLs (e.g., `images/photo.png` → `https://site.com/page/images/photo.png`)
- **Smart image naming** - Downloaded images get a random 3-character prefix to identify images from the same page (e.g., `x7k_photo1.png`, `x7k_photo2.png`)
- **Obsidian attachment folder integration** - Respects your Obsidian settings for attachment locations:
  - Supports absolute paths (e.g., `/Attachments`)
  - Supports relative paths (e.g., `./attachments`)
  - Automatically creates folders if needed
- **Duplicate handling** - Automatically renames files if they already exist
- **Source tracking** - Adds source URL to frontmatter for web clippings

## Installation

### Manual Installation

- Clone this repository or download the files
- Run `./build.sh` to build the plugin
- Copy the built files to your Obsidian plugins directory:

```bash
# Define target directory
TARGET_DIR="[path to your vault]/.obsidian/plugins/clipboard-to-note"

# Create target directory if it doesn't exist
mkdir -p "$TARGET_DIR"

# Copy files to target directory
cp main.js "$TARGET_DIR/"
cp manifest.json "$TARGET_DIR/"
cp styles.css "$TARGET_DIR/"
```

- Restart Obsidian or reload the plugin
- Enable "Clipboard to Note" in Settings → Community Plugins

### Development

```bash
# Install dependencies
npm install

# Build once
npm run build

# Build and watch for changes
npm run dev
```

## Usage

### Create a note from clipboard text

1. Copy any text to your clipboard
2. Click the clipboard icon in the ribbon, or use the command palette: "Create note from clipboard"

The plugin will:
- Analyze the text and generate an appropriate title
- Format the content with proper markdown headers
- Suggest relevant tags based on your vault structure
- Add YAML frontmatter with timestamps and tags
- Save the note to your configured inbox folder
- Open the newly created note

### Create a note from a URL

1. Copy a URL to your clipboard (e.g., `https://arxiv.org/html/2408.13296v1`)
2. Click the clipboard icon in the ribbon, or use the command palette: "Create note from clipboard"

The plugin will:
- Fetch the webpage content
- Extract the page title
- Convert HTML to clean markdown
- Convert all relative image URLs to absolute URLs
- Download images if enabled (with a unique 3-character prefix)
- Suggest relevant tags based on the page content
- Add YAML frontmatter with timestamps, tags, and source URL
- Save the note to your configured inbox folder
- Open the newly created note

### Settings

#### General
- **Inbox folder**: Configure where new notes should be saved (default: "Inbox")

#### AI Settings
- **Use OpenAI for tag suggestions**: Enable AI-powered semantic tag matching using OpenAI API
- **OpenAI API Key**: Your OpenAI API key (required for AI tag suggestions)

#### Web Clipping Settings
- **Download images**: Download images from web pages to local storage (uses Obsidian's native attachment folder setting)

## Tag Suggestion Methods

The plugin offers two methods for suggesting tags:

### Keyword Matching (Default)
- Fast, local matching based on keyword similarity
- Compares clipboard/web page content with your vault's folder names
- Scores matches based on exact folder name matches and word-by-word matching
- Returns the top 3 most relevant tags
- Works offline with no API required

### OpenAI-Powered (Optional)
- Semantic tag matching using OpenAI's GPT-3.5-turbo
- More intelligent understanding of content relevance
- Requires OpenAI API key
- Falls back to keyword matching if API call fails
- Supports multilingual content (German/English)

## Example Output

### YAML Frontmatter
```yaml
---
modified: 2025-10-05 14:30
created: 2025-10-05 14:30
tags: [AI, Research, Technology]
sources: "[Website](https://arxiv.org/html/2408.13296v1)"
---
```

### Downloaded Images
When downloading from a URL like `https://arxiv.org/html/2408.13296v1`:
- `x7k_Overview_of_LLMs.png`
- `x7k_diagram.jpg`
- `x7k_figure1.png`

All images from the same page share the same 3-character prefix (`x7k` in this example) for easy identification.

## Requirements

- Obsidian v0.15.0 or higher
- Internet connection for URL downloading and OpenAI features

### Recommended Plugins

- **[Frontmatter Markdown Links](https://github.com/AndrewMorgan2/obsidian-frontmatter-links)** - This plugin uses the Frontmatter Markdown Links syntax for adding sources to the YAML header (e.g., `sources: "[Website](https://example.com)"`). Installing this plugin will make source links clickable in the frontmatter.

## License

MIT
