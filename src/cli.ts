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

interface PlaceholderStats {
    [key: string]: {
        count: number;
        replacement: string;
    };
}

async function main() {
    // Load package.json for version and description
    const pkg = await fs.readJson(path.join(__dirname, '..', 'package.json'));

    console.log(chalk.cyan(`🚀 Welcome to gen-from v${pkg.version}!`));
    console.log(chalk.dim(`${pkg.description}\n`));

    try {
        // Parse command line arguments
        const args = process.argv.slice(2);

        // Handle version command
        if (args.includes('--version') || args.includes('-v')) {
            console.log(pkg.version);
            process.exit(0);
        }

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

        // Ask for package name suggestion
        const packageName = await suggestPackageName(userInputs.USERNAME, userInputs.PROJECT_NAME);
        if (!packageName) {
            console.log(chalk.red('❌ Setup cancelled'));
            process.exit(1);
        }
        userInputs.PACKAGE_NAME = packageName;

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
            console.log('  pnpm install');
        } else {
            console.log(`  cd ${userInputs.PROJECT_NAME}`);
            console.log('  pnpm install');
        }

        console.log('  pnpm build');
        console.log('  pnpm test\n');

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

    const questions = placeholders.map(placeholder => ({
        type: 'text' as const,
        name: placeholder.key,
        message: placeholder.prompt,
        initial: placeholder.default,
        validate: (value: string) => {
            if (placeholder.required && !value.trim()) {
                return `${placeholder.key} is required`;
            }
            return true;
        }
    }));

    const response = await prompts(questions);

    // Check if user cancelled (any required field is undefined)
    for (const placeholder of placeholders) {
        if (placeholder.required && response[placeholder.key] === undefined) {
            return null;
        }
    }

    return response;
}

async function suggestPackageName(username: string, projectName: string): Promise<string | null> {
    const suggestions = [
        projectName,
        `@${username}/${projectName}`,
        'Use different name'
    ];

    const choices = suggestions.map((suggestion, index) => ({
        title: index === 2 ? chalk.dim(suggestion) : suggestion,
        value: suggestion
    }));

    const response = await prompts({
        type: 'select',
        name: 'packageName',
        message: 'Choose package name:',
        choices,
        initial: 1 // Default to @username/project-name
    });

    if (!response.packageName) {
        return null;
    }

    if (response.packageName === 'Use different name') {
        const customResponse = await prompts({
            type: 'text',
            name: 'customPackageName',
            message: 'Enter package name:',
            initial: `@${username}/${projectName}`,
            validate: (value: string) => {
                if (!value.trim()) {
                    return 'Package name is required';
                }
                return true;
            }
        });

        return customResponse.customPackageName || null;
    }

    return response.packageName;
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
    console.log(chalk.dim('\nProcessing template files...'));

    // Get all files recursively
    const files = await getAllFiles(targetDir);

    // First pass: count placeholders across all files
    const placeholderStats: PlaceholderStats = {};

    for (const [key, value] of Object.entries(userInputs)) {
        placeholderStats[key] = {
            count: 0,
            replacement: value
        };
    }

    // Count placeholders in all files
    for (const filePath of files) {
        if (!isBinaryFile(filePath)) {
            try {
                const content = await fs.readFile(filePath, 'utf-8');
                for (const key of Object.keys(userInputs)) {
                    // Search for the exact key
                    const matches = content.match(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'));
                    if (matches) {
                        placeholderStats[key].count += matches.length;
                    }
                }
            } catch (error) {
                // Skip files that can't be read
            }
        }
    }

    // Show placeholder replacement summary
    console.log(chalk.yellow('\nPlaceholder replacement summary:'));
    let hasReplacements = false;

    for (const [key, stats] of Object.entries(placeholderStats)) {
        if (stats.count > 0) {
            console.log(chalk.cyan(`  ${key}`) + chalk.dim(` => Found ${stats.count} occurrence${stats.count === 1 ? '' : 's'} => Replacing with `) + chalk.green(`"${stats.replacement}"`));
            hasReplacements = true;
        }
    }

    if (!hasReplacements) {
        console.log(chalk.dim('  No placeholders found in template files'));
    }

    console.log(''); // Empty line for spacing

    // Second pass: actually replace the placeholders
    let filesProcessed = 0;
    for (const filePath of files) {
        const wasModified = await processFile(filePath, userInputs);
        if (wasModified) {
            filesProcessed++;
        }
    }

    if (hasReplacements && filesProcessed > 0) {
        console.log(chalk.green(`✓ ${filesProcessed} file${filesProcessed === 1 ? '' : 's'} processed`));
    } else {
        console.log(chalk.green('✓ Template files copied'));
    }
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

async function processFile(filePath: string, userInputs: UserInputs): Promise<boolean> {
    try {
        // Skip binary files
        if (isBinaryFile(filePath)) {
            return false;
        }

        let content = await fs.readFile(filePath, 'utf-8');
        let hasChanges = false;

        // Special handling for package.json
        if (path.basename(filePath) === 'package.json') {
            try {
                const packageJson = JSON.parse(content);

                // Replace package name
                if (userInputs.PACKAGE_NAME) {
                    packageJson.name = userInputs.PACKAGE_NAME;
                    hasChanges = true;
                }

                // Update author fields only if they exist and we have values
                if (packageJson.author && typeof packageJson.author === 'object') {
                    if (userInputs.AUTHOR_NAME && packageJson.author.name) {
                        packageJson.author.name = userInputs.AUTHOR_NAME;
                        hasChanges = true;
                    }
                    if (userInputs.USERNAME && packageJson.author.url) {
                        packageJson.author.url = `https://github.com/${userInputs.USERNAME}`;
                        hasChanges = true;
                    }
                } else if (packageJson.author && typeof packageJson.author === 'string' && userInputs.AUTHOR_NAME) {
                    packageJson.author = userInputs.AUTHOR_NAME;
                    hasChanges = true;
                }

                // Update repository URL only if it exists
                if (packageJson.repository && userInputs.USERNAME && userInputs.PROJECT_NAME) {
                    if (typeof packageJson.repository === 'string') {
                        packageJson.repository = `https://github.com/${userInputs.USERNAME}/${userInputs.PROJECT_NAME}`;
                        hasChanges = true;
                    } else if (packageJson.repository.url) {
                        packageJson.repository.url = `https://github.com/${userInputs.USERNAME}/${userInputs.PROJECT_NAME}`;
                        hasChanges = true;
                    }
                }

                // Update bugs URL only if it exists
                if (packageJson.bugs && userInputs.USERNAME && userInputs.PROJECT_NAME) {
                    if (typeof packageJson.bugs === 'string') {
                        packageJson.bugs = `https://github.com/${userInputs.USERNAME}/${userInputs.PROJECT_NAME}/issues`;
                        hasChanges = true;
                    } else if (packageJson.bugs.url) {
                        packageJson.bugs.url = `https://github.com/${userInputs.USERNAME}/${userInputs.PROJECT_NAME}/issues`;
                        hasChanges = true;
                    }
                }

                // Update homepage only if it exists
                if (packageJson.homepage && userInputs.USERNAME && userInputs.PROJECT_NAME) {
                    packageJson.homepage = `https://github.com/${userInputs.USERNAME}/${userInputs.PROJECT_NAME}`;
                    hasChanges = true;
                }

                // Update keywords only if they exist - merge instead of replace
                if (packageJson.keywords && Array.isArray(packageJson.keywords) && userInputs.PROJECT_NAME) {
                    const newKeywords = [
                        'typescript',
                        'javascript',
                        userInputs.PROJECT_NAME.toLowerCase(),
                        'utility'
                    ];

                    // Merge existing keywords with new ones, remove duplicates
                    packageJson.keywords = [...new Set([...packageJson.keywords, ...newKeywords])];
                    hasChanges = true;
                }

                if (hasChanges) {
                    content = JSON.stringify(packageJson, null, 2);
                }

            } catch (parseError) {
                // If JSON parsing fails, fall back to string replacement
                console.warn(chalk.yellow(`⚠ Warning: Could not parse package.json, using string replacement`));
            }
        }

        // Standard string replacement for all files (including non-JSON parts)
        for (const [key, value] of Object.entries(userInputs)) {
            if (content.includes(key)) {
                content = content.replace(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value);
                hasChanges = true;
            }
        }

        if (hasChanges) {
            await fs.writeFile(filePath, content, 'utf-8');
        }

        return hasChanges;
    } catch (error) {
        console.warn(chalk.yellow(`⚠ Warning: Could not process file ${filePath}: ${error}`));
        return false;
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
            item !== 'yarn.lock' &&
            item !== 'pnpm-lock.yaml'
        );
        return relevantFiles.length > 0;
    } catch {
        return false;
    }
}

main().catch(console.error);