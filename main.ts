import { App, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder, normalizePath, requestUrl } from 'obsidian';
import TurndownService from 'turndown';
// @ts-ignore
import { gfm } from 'turndown-plugin-gfm';

interface ClipboardToNoteSettings {
	inboxFolder: string;
	useOpenAI: boolean;
	openAIApiKey: string;
	downloadImages: boolean;
}

const DEFAULT_SETTINGS: ClipboardToNoteSettings = {
	inboxFolder: 'Inbox',
	useOpenAI: false,
	openAIApiKey: '',
	downloadImages: false
}

export default class ClipboardToNotePlugin extends Plugin {
	settings: ClipboardToNoteSettings;
	turndownService: TurndownService;

	async onload() {
		await this.loadSettings();

		// Initialize Turndown
		this.turndownService = new TurndownService({
			headingStyle: 'atx',
			hr: '---',
			bulletListMarker: '-',
			codeBlockStyle: 'fenced',
			emDelimiter: '*'
		});

		// Add GFM (GitHub Flavored Markdown) support for tables, strikethrough, etc.
		this.turndownService.use(gfm);

		// Add ribbon icon
		this.addRibbonIcon('clipboard', 'Create note from clipboard', async () => {
			await this.createNoteFromClipboard();
		});

		// Add command
		this.addCommand({
			id: 'create-note-from-clipboard',
			name: 'Create note from clipboard',
			callback: async () => {
				await this.createNoteFromClipboard();
			}
		});

		// Add settings tab
		this.addSettingTab(new ClipboardToNoteSettingTab(this.app, this));
	}

	// OpenAI-powered tag suggestion
	async suggestTagsOpenAI(text: string): Promise<string[]> {
		if (!this.settings.openAIApiKey) {
			console.log('OpenAI API key not set, falling back to keyword matching');
			return this.suggestTagsKeyword(text);
		}

		try {
			// Get all folder names
			const folders = this.app.vault.getAllFolders();
			const folderNames = folders
				.filter(f => f.path !== '' && f.path !== '/')
				.map(f => {
					const parts = f.path.split('/');
					return parts[parts.length - 1];
				});

			if (folderNames.length === 0) {
				return [];
			}

			// Call OpenAI API
			const response = await fetch('https://api.openai.com/v1/chat/completions', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${this.settings.openAIApiKey}`
				},
				body: JSON.stringify({
					model: 'gpt-3.5-turbo',
					messages: [
						{
							role: 'system',
							content: 'You are a helpful assistant that suggests relevant tags for notes based on their content. You will be given note content and a list of available folder/tag names. Return only the 3 most relevant tags as a JSON array of strings. The tags must be from the provided list.'
						},
						{
							role: 'user',
							content: `Note content:\n${text}\n\nAvailable tags:\n${folderNames.join(', ')}\n\nReturn the 3 most relevant tags as a JSON array.`
						}
					],
					temperature: 0.3,
					max_tokens: 100
				})
			});

			if (!response.ok) {
				const error = await response.text();
				console.error('OpenAI API error:', error);
				return this.suggestTagsKeyword(text);
			}

			const data = await response.json();
			const content = data.choices[0].message.content.trim();

			// Parse JSON response
			const tags = JSON.parse(content);

			if (Array.isArray(tags)) {
				console.log('OpenAI suggested tags:', tags);
				return tags.slice(0, 3);
			}

			return this.suggestTagsKeyword(text);
		} catch (error) {
			console.error('Error calling OpenAI API:', error);
			return this.suggestTagsKeyword(text);
		}
	}

	// Simple keyword-based tag suggestion (fallback)
	suggestTagsKeyword(text: string): string[] {
		const folders = this.app.vault.getAllFolders();
		const lowerText = text.toLowerCase();
		const tags: { folder: string; score: number }[] = [];

		for (const folder of folders) {
			if (folder.path === '' || folder.path === '/') continue;

			// Get folder name (last part of path)
			const parts = folder.path.split('/');
			const folderName = parts[parts.length - 1];
			const lowerFolderName = folderName.toLowerCase();

			// Calculate simple keyword match score
			let score = 0;

			// Exact folder name match
			if (lowerText.includes(lowerFolderName)) {
				score += 10;
			}

			// Word-by-word matching
			const folderWords = lowerFolderName.split(/[\s-_]+/);
			for (const word of folderWords) {
				if (word.length > 2 && lowerText.includes(word)) {
					score += 3;
				}
			}

			if (score > 0) {
				tags.push({ folder: folderName, score });
			}
		}

		// Sort by score and return top 3
		tags.sort((a, b) => b.score - a.score);
		return tags.slice(0, 3).map(t => t.folder);
	}

	isURL(text: string): boolean {
		const trimmed = text.trim();
		// Check if it's a single line and starts with http/https
		if (trimmed.split('\n').length > 1) return false;
		return /^https?:\/\/.+/.test(trimmed);
	}

	async fetchURLContent(url: string): Promise<{ title: string; content: string; html: string }> {
		try {
			// Use Obsidian's requestUrl which bypasses CORS
			const response = await requestUrl({
				url: url,
				method: 'GET',
				headers: {
					'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
				}
			});

			if (response.status !== 200) {
				throw new Error(`HTTP ${response.status}: Failed to fetch URL`);
			}

			const html = response.text;

			if (!html || html.trim() === '') {
				throw new Error('Received empty response from URL');
			}

			const parser = new DOMParser();
			const doc = parser.parseFromString(html, 'text/html');

			// Extract title
			let title = doc.querySelector('title')?.textContent ||
						doc.querySelector('h1')?.textContent ||
						'Web Clipping';
			title = title.trim();

			// Convert HTML to markdown using Turndown
			const markdown = this.turndownService.turndown(doc.body);

			return { title, content: markdown, html };
		} catch (error) {
			console.error('Error fetching URL:', error);
			throw new Error(`Failed to fetch URL: ${error.message}`);
		}
	}

	getAttachmentFolder(notePath: string): string {
		// @ts-ignore - accessing Obsidian's internal settings
		const attachmentFolderPath = this.app.vault.getConfig('attachmentFolderPath');
		// @ts-ignore - accessing Obsidian's internal settings
		const subfolderFormat = this.app.vault.getConfig('newFileFolderPath');

		// If no specific attachment folder is set, use same folder as note
		if (!attachmentFolderPath || attachmentFolderPath === '/') {
			const noteDir = notePath.substring(0, notePath.lastIndexOf('/'));
			return noteDir || '.';
		}

		// If it's an absolute path, use it directly
		if (attachmentFolderPath.startsWith('/') || !attachmentFolderPath.includes('./')) {
			return attachmentFolderPath;
		}

		// If it's a relative path (e.g., "./attachments"), resolve it relative to note location
		if (attachmentFolderPath.startsWith('./')) {
			const noteDir = notePath.substring(0, notePath.lastIndexOf('/'));
			const relPath = attachmentFolderPath.substring(2); // Remove "./"
			return noteDir ? `${noteDir}/${relPath}` : relPath;
		}

		return attachmentFolderPath;
	}

	async downloadImage(imageUrl: string, filename: string, notePath: string): Promise<string> {
		try {
			// Use Obsidian's requestUrl to bypass CORS
			const response = await requestUrl({
				url: imageUrl,
				method: 'GET'
			});

			if (response.status !== 200) {
				throw new Error(`HTTP ${response.status}: Failed to download image`);
			}

			const buffer = new Uint8Array(response.arrayBuffer);

			// Get Obsidian's attachment folder based on note location
			const attachmentFolder = this.getAttachmentFolder(notePath);

			// Ensure attachment folder exists
			if (attachmentFolder !== '.' && attachmentFolder !== '/') {
				await this.ensureFolderExists(attachmentFolder);
			}

			// Create safe filename
			const safeFilename = filename.replace(/[\\/:*?"<>|]/g, '-');
			const filePath = normalizePath(`${attachmentFolder}/${safeFilename}`);

			// Check if file exists, add number if needed
			let finalPath = filePath;
			let counter = 1;
			const baseFilename = safeFilename.replace(/\.[^.]+$/, ''); // Remove extension
			const extension = safeFilename.match(/\.[^.]+$/)?.[0] || '';

			while (this.app.vault.getAbstractFileByPath(finalPath)) {
				finalPath = normalizePath(`${attachmentFolder}/${baseFilename}-${counter}${extension}`);
				counter++;
			}

			// Save file
			await this.app.vault.createBinary(finalPath, buffer);

			return finalPath;
		} catch (error) {
			console.error('Error downloading image:', error);
			return imageUrl; // Return original URL if download fails
		}
	}

	async generateTitle(text: string): Promise<string> {
		// Simple title generation: take first sentence or first 50 chars
		const firstLine = text.trim().split('\n')[0];
		const cleaned = firstLine.replace(/^#+\s*/, '').trim(); // Remove any existing markdown headers

		if (cleaned.length > 50) {
			return cleaned.substring(0, 50).trim() + '...';
		}

		return cleaned || 'Untitled Note';
	}

	formatMarkdown(text: string, title: string): string {
		let content = text.trim();

		// Remove the title from content if it appears at the beginning
		// Escape special regex characters in the title
		const escapedTitle = title.replace(/\.\.\.$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const titlePattern = new RegExp(`^#*\\s*${escapedTitle}`, 'i');
		content = content.replace(titlePattern, '').trim();

		// Ensure headers don't use H1
		content = content.replace(/^# /gm, '## ');

		return content;
	}

	createYamlFrontmatter(tags: string[], sourceUrl?: string): string {
		const now = new Date();
		const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

		const tagString = tags.length > 0 ? `[${tags.join(', ')}]` : '[]';

		let frontmatter = `---
modified: ${timestamp}
created: ${timestamp}
tags: ${tagString}`;

		if (sourceUrl) {
			frontmatter += `\nsources: "[Website](${sourceUrl})"`;
		}

		frontmatter += '\n---';

		return frontmatter;
	}

	async ensureFolderExists(folderPath: string) {
		const normalizedPath = normalizePath(folderPath);
		const folder = this.app.vault.getAbstractFileByPath(normalizedPath);

		if (!folder) {
			console.log(`Creating folder: ${normalizedPath}`);
			try {
				await this.app.vault.createFolder(normalizedPath);
				console.log(`Folder created successfully: ${normalizedPath}`);
			} catch (error) {
				console.error(`Failed to create folder ${normalizedPath}:`, error);
				throw error;
			}
		} else {
			console.log(`Folder already exists: ${normalizedPath}`);
		}
	}

	async createNoteFromClipboard() {
		try {
			// Read clipboard
			const clipboardText = await navigator.clipboard.readText();

			if (!clipboardText || clipboardText.trim() === '') {
				new Notice('Clipboard is empty');
				return;
			}

			console.log('Clipboard content:', clipboardText.substring(0, 100));

			let title: string;
			let content: string;
			let tags: string[];
			let sourceUrl: string | undefined;

			// Check if clipboard contains a URL
			if (this.isURL(clipboardText)) {
				const url = clipboardText.trim();
				new Notice('Fetching content from URL...');

				try {
					const { title: pageTitle, content: pageContent, html } = await this.fetchURLContent(url);
					title = pageTitle;
					sourceUrl = url;

					// First, convert all relative image URLs to absolute URLs
					// This ensures valid references whether or not images are downloaded
					content = await this.convertRelativeImageUrls(pageContent, url);

					// Images will be downloaded after creating the note (if enabled)
					// so we have the note path for proper attachment folder resolution

					// Suggest tags based on page content
					tags = this.settings.useOpenAI
						? await this.suggestTagsOpenAI(pageContent)
						: this.suggestTagsKeyword(pageContent);

					new Notice('URL content fetched successfully');
				} catch (error) {
					new Notice(`Failed to fetch URL: ${error.message}`);
					return;
				}
			} else {
				// Regular text processing
				new Notice('Processing clipboard content...');

				title = await this.generateTitle(clipboardText);
				console.log('Generated title:', title);

				// Suggest tags
				tags = this.settings.useOpenAI
					? await this.suggestTagsOpenAI(clipboardText)
					: this.suggestTagsKeyword(clipboardText);
				console.log('Suggested tags:', tags);

				// Format markdown
				content = this.formatMarkdown(clipboardText, title);
			}

			// Create YAML frontmatter
			const frontmatter = this.createYamlFrontmatter(tags, sourceUrl);

			// Combine everything
			const fullContent = `${frontmatter}\n\n${content}`;

			console.log('Inbox folder setting:', this.settings.inboxFolder);

			// Ensure inbox folder exists
			await this.ensureFolderExists(this.settings.inboxFolder);

			// Create safe filename
			const safeTitle = title.replace(/[\\/:*?"<>|]/g, '-');
			const fileName = `${safeTitle}.md`;
			const filePath = normalizePath(`${this.settings.inboxFolder}/${fileName}`);

			console.log('Attempting to create file at:', filePath);

			// Check if file exists, add number if needed
			let finalPath = filePath;
			let counter = 1;
			while (this.app.vault.getAbstractFileByPath(finalPath)) {
				const baseTitle = safeTitle.replace(/\.\.\.$/, '');
				finalPath = normalizePath(`${this.settings.inboxFolder}/${baseTitle}-${counter}.md`);
				counter++;
			}

			console.log('Final file path:', finalPath);

			// Create the file
			const file = await this.app.vault.create(finalPath, fullContent);
			console.log('File created:', file.path);

			// Download images if this was a URL and download images is enabled
			if (sourceUrl && this.settings.downloadImages) {
				new Notice('Downloading images...');
				// Generate a random 3-character prefix for all images from this page
				const imagePrefix = this.generateImagePrefix();
				const contentWithLocalImages = await this.downloadImagesInContent(content, sourceUrl, file.path, imagePrefix);

				// Update the file with local image paths
				const updatedFrontmatter = this.createYamlFrontmatter(tags, sourceUrl);
				const updatedContent = `${updatedFrontmatter}\n\n${contentWithLocalImages}`;
				await this.app.vault.modify(file, updatedContent);
			}

			// Open the file
			const leaf = this.app.workspace.getLeaf(false);
			await leaf.openFile(file);

			new Notice(`Note created: ${file.basename} in ${this.settings.inboxFolder}`);

		} catch (error) {
			console.error('Error creating note from clipboard:', error);
			new Notice(`Error creating note: ${error.message}`);
		}
	}

	generateImagePrefix(): string {
		// Generate a random 3-character alphanumeric prefix
		const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
		let prefix = '';
		for (let i = 0; i < 3; i++) {
			prefix += chars.charAt(Math.floor(Math.random() * chars.length));
		}
		return prefix;
	}

	async convertRelativeImageUrls(markdownContent: string, baseUrl: string): Promise<string> {
		// Find all image references in markdown
		const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
		let match;
		const replacements: { original: string; replacement: string }[] = [];

		console.log('Converting relative image URLs to absolute...');
		console.log('Base URL:', baseUrl);

		// Ensure base URL ends with / for proper relative URL resolution
		// If the URL looks like a page (no trailing slash and has path segments),
		// treat it as a directory by adding a trailing slash
		let normalizedBaseUrl = baseUrl;
		if (!baseUrl.endsWith('/')) {
			// Add trailing slash to treat the URL as a directory
			normalizedBaseUrl = baseUrl + '/';
		}

		console.log('Normalized base URL:', normalizedBaseUrl);

		while ((match = imageRegex.exec(markdownContent)) !== null) {
			const fullMatch = match[0];
			const alt = match[1];
			const imageUrl = match[2];

			// Skip if already an absolute URL
			if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
				continue;
			}

			// Skip data URLs and other special schemes
			if (imageUrl.startsWith('data:') || imageUrl.startsWith('blob:')) {
				continue;
			}

			try {
				// Convert relative URL to absolute using normalized base URL
				const absoluteUrl = new URL(imageUrl, normalizedBaseUrl).toString();
				console.log(`Converting relative URL: ${imageUrl} -> ${absoluteUrl}`);

				const replacement = `![${alt}](${absoluteUrl})`;
				replacements.push({ original: fullMatch, replacement });
			} catch (error) {
				console.error(`Failed to convert relative URL ${imageUrl}:`, error);
			}
		}

		// Apply all replacements
		let result = markdownContent;
		for (const { original, replacement } of replacements) {
			result = result.replace(original, replacement);
		}

		console.log(`Converted ${replacements.length} relative image URLs to absolute`);
		return result;
	}

	async downloadImagesInContent(markdownContent: string, baseUrl: string, notePath: string, prefix: string): Promise<string> {
		// Find all image references in markdown
		const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
		let match;
		const replacements: { original: string; replacement: string }[] = [];

		console.log('Starting image download process...');
		console.log('Markdown content length:', markdownContent.length);
		console.log('Note path:', notePath);
		console.log('Image prefix:', prefix);

		while ((match = imageRegex.exec(markdownContent)) !== null) {
			const fullMatch = match[0];
			const alt = match[1];
			let imageUrl = match[2];

			console.log('Found image:', imageUrl);

			// Skip if not an HTTP(S) URL (should already be absolute at this point)
			if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
				console.log('Skipping non-http image:', imageUrl);
				continue;
			}

			try {
				// Create filename from URL
				const url = new URL(imageUrl);
				const pathname = url.pathname;
				let filename = pathname.split('/').pop() || 'image.jpg';

				// Add extension if missing
				if (!filename.includes('.')) {
					filename += '.jpg';
				}

				// Add prefix to filename
				const prefixedFilename = `${prefix}_${filename}`;

				console.log('Downloading image:', imageUrl, 'as', prefixedFilename);

				// Download image with note path context
				const localPath = await this.downloadImage(imageUrl, prefixedFilename, notePath);

				console.log('Image downloaded to:', localPath);

				// Create replacement with local path
				const replacement = `![${alt}](${localPath})`;
				replacements.push({ original: fullMatch, replacement });

				console.log(`Successfully downloaded: ${imageUrl} -> ${localPath}`);
			} catch (error) {
				console.error(`Failed to download image ${imageUrl}:`, error);
				// Keep the absolute URL if download fails
			}
		}

		console.log(`Total images processed: ${replacements.length}`);

		// Apply all replacements
		let result = markdownContent;
		for (const { original, replacement } of replacements) {
			result = result.replace(original, replacement);
		}

		return result;
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class ClipboardToNoteSettingTab extends PluginSettingTab {
	plugin: ClipboardToNotePlugin;

	constructor(app: App, plugin: ClipboardToNotePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Inbox folder')
			.setDesc('Folder where new notes will be created')
			.addText(text => text
				.setPlaceholder('Inbox')
				.setValue(this.plugin.settings.inboxFolder)
				.onChange(async (value) => {
					this.plugin.settings.inboxFolder = value || 'Inbox';
					await this.plugin.saveSettings();
				}));

		containerEl.createEl('h3', { text: 'AI Settings' });

		new Setting(containerEl)
			.setName('Use OpenAI for tag suggestions')
			.setDesc('Enable AI-powered semantic tag matching using OpenAI API')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.useOpenAI)
				.onChange(async (value) => {
					this.plugin.settings.useOpenAI = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('OpenAI API Key')
			.setDesc('Enter your OpenAI API key (required for AI tag suggestions)')
			.addText(text => text
				.setPlaceholder('sk-...')
				.setValue(this.plugin.settings.openAIApiKey)
				.onChange(async (value) => {
					this.plugin.settings.openAIApiKey = value;
					await this.plugin.saveSettings();
				})
				.inputEl.setAttribute('type', 'password'));

		containerEl.createEl('h3', { text: 'Web Clipping Settings' });

		new Setting(containerEl)
			.setName('Download images')
			.setDesc('Download images from web pages to local storage (uses Obsidian\'s native attachment folder setting)')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.downloadImages)
				.onChange(async (value) => {
					this.plugin.settings.downloadImages = value;
					await this.plugin.saveSettings();
				}));

	}
}
