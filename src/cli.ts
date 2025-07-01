#!/usr/bin/env node

import prompts from 'prompts';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import {fileURLToPath} from 'url';
import degit from 'tiged';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface Template {
    name: string;
    description: string;
    repo: string;
}

interface Placeholder {
    key: string;
    prompt: string;
    default: string;
    required: boolean;
}

interface Config {
    templates: Template[];
    placeholders: Placeholder[];
}

interface UserInputs {
    [key: string]: string;
}

async function main() {
    console.log(chalk.cyan('🚀 Welcome to gen-from!'));
    console.log(chalk.dim('Generate projects from GitHub template repositories\n'));

    try {
        // Parse command line arguments
        const args = process.argv.slice(2);
        const templateArg = args[0];
        const isHereFlag = args.includes('--here');

        // Load config
        const config = await loadConfig();

        // Select template
        const selectedTemplate = await selectTemplate(config.templates, templateArg);
        if (!selectedTemplate) {
            console.log(chalk.red('❌ Template selection cancelled'));
            process.exit(1);
        }

        // Validate template exists
        console.log(chalk.dim(`Checking template: ${selectedTemplate.repo}...`));
        await validateTemplate(selectedTemplate.repo);

        // Collect user inputs
        const userInputs = await collectInputs(config.placeholders);
        if (!userInputs) {
            console.log(chalk.red('❌ Setup cancelled'));
            process.exit(1);
        }

        // Determine target directory
        const targetDir = isHereFlag ? '.' : userInputs.PROJECT_NAME;

        // Check for existing files and prompt for replacement
        if (!isHereFlag && await fs.pathExists(targetDir)) {
            const shouldReplace = await promptForReplacement(targetDir);
            if (!shouldReplace) {
                console.log(chalk.yellow('❌ Operation cancelled'));
                process.exit(0);
            }
        } else if (isHereFlag) {
            const hasFiles = await hasExistingFiles('.');
            if (hasFiles) {
                const shouldReplace = await promptForReplacement('.', true);
                if (!shouldReplace) {
                    console.log(chalk.yellow('❌ Operation cancelled'));
                    process.exit(0);
                }
            }
        }

        // Download template
        await downloadTemplate(selectedTemplate.repo, targetDir);

        // Process files
        await processFiles(targetDir, userInputs);

        // Success
        console.log(chalk.green('✅ Project generated successfully!'));
        console.log(`\n${chalk.yellow('Next steps:')}`);

        if (isHereFlag) {
            console.log('  npm install');
        } else {
            console.log(`  cd ${userInputs.PROJECT_NAME}`);
            console.log('  npm install');
        }

        console.log('  npm run build');
        console.log('  npm test\n');

    } catch (error) {
        console.error(chalk.red('❌ Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
    }
}

async function loadConfig(): Promise<Config> {
    const templatesPath = path.join(__dirname, '..', 'templates.json');
    const placeholdersPath = path.join(__dirname, '..', 'placeholders.json');

    if (!await fs.pathExists(templatesPath)) {
        throw new Error('Templates configuration file not found');
    }

    if (!await fs.pathExists(placeholdersPath)) {
        throw new Error('Placeholders configuration file not found');
    }

    const templates = await fs.readJson(templatesPath);
    const placeholders = await fs.readJson(placeholdersPath);

    return {
        templates,
        placeholders
    };
}

async function selectTemplate(templates: Template[], templateArg?: string): Promise<Template | null> {
    if (templateArg) {
        // Check if it's a user/repo format or just repo name
        let repoPath: string;
        if (templateArg.includes('/')) {
            repoPath = templateArg;
        } else {
            // Default to phucbm/ prefix for backward compatibility
            repoPath = `phucbm/${templateArg}`;
        }

        // Try to find in templates list first
        const found = templates.find(t => t.name === templateArg || t.repo === templateArg || t.repo === repoPath);
        if (found) {
            return found;
        }

        // If not in templates list, create a template object for the repo
        return {
            name: templateArg,
            description: `Template from ${repoPath}`,
            repo: repoPath
        };
    }

    // Show template selection
    console.log(chalk.yellow('Available templates:'));

    const choices = templates.map(template => ({
        title: `${template.name} - ${chalk.dim(template.description)}`,
        value: template
    }));

    const response = await prompts({
        type: 'select',
        name: 'template',
        message: 'Select a template:',
        choices,
        initial: 0
    });

    return response.template || null;
}

async function validateTemplate(repoName: string): Promise<void> {
    // Check if GitHub repo exists by trying to access it
    const response = await fetch(`https://api.github.com/repos/${repoName}`);

    if (!response.ok) {
        if (response.status === 404) {
            throw new Error(`Template repository "${repoName}" not found on GitHub`);
        } else {
            throw new Error(`Failed to verify template repository: ${response.statusText}`);
        }
    }
}

async function collectInputs(placeholders: Placeholder[]): Promise<UserInputs | null> {
    console.log(chalk.yellow('\nProvide project information:'));

    const questions = placeholders.map(placeholder => {
        let defaultValue = placeholder.default;

        return {
            type: 'text' as const,
            name: placeholder.key,
            message: placeholder.prompt,
            initial: defaultValue,
            validate: (value: string) => {
                if (placeholder.required && !value.trim()) {
                    return `${placeholder.key} is required`;
                }
                return true;
            }
        };
    });

    // Process questions in order, handling dynamic defaults
    const results: UserInputs = {};

    for (const question of questions) {
        // Update default if it references other values
        if (question.initial?.includes('{{') && results.PROJECT_NAME) {
            question.initial = question.initial.replace('{{PROJECT_NAME}}', results.PROJECT_NAME);
        }

        const response = await prompts(question);

        if (response[question.name] === undefined) {
            return null; // User cancelled
        }

        results[question.name] = response[question.name];
    }

    return results;
}

async function downloadTemplate(repoName: string, targetDir: string): Promise<void> {
    console.log(chalk.dim(`\nDownloading template from ${repoName}...`));

    const emitter = degit(repoName, {
        cache: false,
        force: true,
        verbose: false
    });

    try {
        await emitter.clone(targetDir);
        console.log(chalk.green('✓ Template downloaded'));
    } catch (error) {
        throw new Error(`Failed to download template: ${error instanceof Error ? error.message : error}`);
    }
}

async function processFiles(targetDir: string, userInputs: UserInputs): Promise<void> {
    console.log(chalk.dim('Processing template files...'));

    // Get all files recursively
    const files = await getAllFiles(targetDir);

    for (const filePath of files) {
        await processFile(filePath, userInputs);
    }

    console.log(chalk.green('✓ Files processed'));
}

async function getAllFiles(dir: string): Promise<string[]> {
    const files: string[] = [];

    async function scan(currentDir: string) {
        const items = await fs.readdir(currentDir);

        for (const item of items) {
            const fullPath = path.join(currentDir, item);
            const stat = await fs.stat(fullPath);

            if (stat.isDirectory()) {
                // Skip node_modules and .git directories
                if (item !== 'node_modules' && item !== '.git') {
                    await scan(fullPath);
                }
            } else {
                files.push(fullPath);
            }
        }
    }

    await scan(dir);
    return files;
}

async function processFile(filePath: string, userInputs: UserInputs): Promise<void> {
    try {
        // Skip binary files
        if (isBinaryFile(filePath)) {
            return;
        }

        let content = await fs.readFile(filePath, 'utf-8');
        let hasChanges = false;

        // Replace all placeholders
        for (const [key, value] of Object.entries(userInputs)) {
            const placeholder = `{{${key}}}`;
            if (content.includes(placeholder)) {
                // Handle special cases
                let replacement = value;

                if (key === 'KEYWORDS' && typeof value === 'string') {
                    // Convert comma-separated string to JSON array for package.json
                    if (filePath.endsWith('package.json')) {
                        const keywords = value.split(',').map(k => k.trim()).filter(k => k);
                        replacement = JSON.stringify(keywords).slice(1, -1); // Remove outer brackets
                    }
                }

                content = content.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), replacement);
                hasChanges = true;
            }
        }

        if (hasChanges) {
            await fs.writeFile(filePath, content, 'utf-8');
        }
    } catch (error) {
        console.warn(chalk.yellow(`⚠ Warning: Could not process file ${filePath}: ${error}`));
    }
}

function isBinaryFile(filePath: string): boolean {
    const binaryExtensions = [
        '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg',
        '.pdf', '.zip', '.tar', '.gz', '.7z',
        '.exe', '.dll', '.so', '.dylib',
        '.woff', '.woff2', '.ttf', '.otf'
    ];

    const ext = path.extname(filePath).toLowerCase();
    return binaryExtensions.includes(ext);
}

async function promptForReplacement(targetPath: string, isCurrentDir = false): Promise<boolean> {
    const message = isCurrentDir
        ? 'Current directory contains files. This will overwrite existing files. Continue?'
        : `Directory "${targetPath}" already exists. This will overwrite existing files. Continue?`;

    const response = await prompts({
        type: 'confirm',
        name: 'replace',
        message,
        initial: false
    });

    return response.replace || false;
}

async function hasExistingFiles(dir: string): Promise<boolean> {
    try {
        const items = await fs.readdir(dir);
        // Filter out hidden files and common non-project files
        const relevantFiles = items.filter(item =>
            !item.startsWith('.') &&
            item !== 'node_modules' &&
            item !== 'package-lock.json' &&
            item !== 'yarn.lock'
        );
        return relevantFiles.length > 0;
    } catch {
        return false;
    }
}

main().catch(console.error);