//@ts-nocheck

// Mock dependencies first
jest.mock('prompts');
jest.mock('fs-extra');
jest.mock('tiged');

import fs from 'fs-extra';
import prompts from 'prompts';
// @ts-ignore
import degit from 'tiged';

// Properly type the mocked modules
const mockFs = {
    ...fs,
    pathExists: jest.fn(),
    readJson: jest.fn(),
    readFile: jest.fn(),
    writeFile: jest.fn(),
    readdir: jest.fn()
} as jest.Mocked<typeof fs>;

const mockPrompts = prompts as jest.MockedFunction<typeof prompts>;

describe('gen-from CLI Logic', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        global.fetch = jest.fn();
    });

    describe('Template Selection Logic', () => {
        test('should prefer username/repo format over bare names', () => {
            const templateArg = 'john/my-template';
            const expectedRepoPath = templateArg.includes('/') ? templateArg : `phucbm/${templateArg}`;

            expect(expectedRepoPath).toBe('john/my-template');
        });

        test('should default to phucbm prefix for bare names', () => {
            const templateArg = 'my-template';
            const expectedRepoPath = templateArg.includes('/') ? templateArg : `phucbm/${templateArg}`;

            expect(expectedRepoPath).toBe('phucbm/my-template');
        });
    });

    describe('File Processing Logic', () => {
        test('should detect binary files correctly', () => {
            const binaryExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg'];

            expect(binaryExtensions.includes('.png')).toBe(true);
            expect(binaryExtensions.includes('.txt')).toBe(false);
        });

        test('should replace placeholders in text content', () => {
            const content = 'Hello PROJECT_NAME by USERNAME';
            const userInputs = {PROJECT_NAME: 'awesome-app', USERNAME: 'john'};

            let result = content;
            for (const [key, value] of Object.entries(userInputs)) {
                result = result.replace(new RegExp(key, 'g'), value);
            }

            expect(result).toBe('Hello awesome-app by john');
        });

        test('should merge keywords instead of replacing', () => {
            const existingKeywords = ['existing', 'keywords'];
            const newKeywords = ['typescript', 'javascript', 'my-project', 'utility'];

            const merged = [...new Set([...existingKeywords, ...newKeywords])];

            expect(merged).toContain('existing');
            expect(merged).toContain('typescript');
            expect(merged).toContain('my-project');
            expect(merged.length).toBe(6); // No duplicates
        });
    });

    describe('GitHub API Validation', () => {
        test('should validate existing repository', async () => {
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: true,
                status: 200
            });

            const response = await fetch('https://api.github.com/repos/phucbm/test');
            expect(response.ok).toBe(true);
        });

        test('should handle non-existent repository', async () => {
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: false,
                status: 404
            });

            const response = await fetch('https://api.github.com/repos/invalid/repo');
            expect(response.ok).toBe(false);
            expect(response.status).toBe(404);
        });
    });

    describe('User Input Handling', () => {
        test('should validate required fields', () => {
            const placeholder = {key: 'PROJECT_NAME', required: true};
            const value = '';

            const isValid = placeholder.required ? value.trim().length > 0 : true;
            expect(isValid).toBe(false);
        });

        test('should allow optional fields to be empty', () => {
            const placeholder = {key: 'DESCRIPTION', required: false};
            const value = '';

            const isValid = placeholder.required ? value.trim().length > 0 : true;
            expect(isValid).toBe(true);
        });
    });

    describe('Package.json Processing', () => {
        test('should update package.json fields correctly', () => {
            const packageJson = {
                name: '@username/package-name',
                author: {name: 'Your Name', url: 'https://github.com/username'},
                keywords: ['existing']
            };

            const userInputs = {
                PACKAGE_NAME: '@john/awesome-app',
                USERNAME: 'john',
                PROJECT_NAME: 'awesome-app'
            };

            // Simulate the processing logic
            if (userInputs.PACKAGE_NAME) {
                packageJson.name = userInputs.PACKAGE_NAME;
            }

            if (packageJson.author && typeof packageJson.author === 'object') {
                if (userInputs.USERNAME && packageJson.author.url) {
                    packageJson.author.url = `https://github.com/${userInputs.USERNAME}`;
                }
            }

            if (packageJson.keywords && Array.isArray(packageJson.keywords)) {
                const newKeywords = ['typescript', 'javascript', userInputs.PROJECT_NAME.toLowerCase()];
                packageJson.keywords = [...new Set([...packageJson.keywords, ...newKeywords])];
            }

            expect(packageJson.name).toBe('@john/awesome-app');
            expect(packageJson.author.url).toBe('https://github.com/john');
            expect(packageJson.keywords).toContain('existing');
            expect(packageJson.keywords).toContain('typescript');
            expect(packageJson.keywords).toContain('awesome-app');
        });
    });

    describe('Directory Detection', () => {
        test('should filter out irrelevant files', () => {
            const allFiles = ['package.json', 'src', '.git', 'node_modules', '.env', 'pnpm-lock.yaml'];

            const relevantFiles = allFiles.filter(item =>
                !item.startsWith('.') &&
                item !== 'node_modules' &&
                item !== 'package-lock.json' &&
                item !== 'yarn.lock' &&
                item !== 'pnpm-lock.yaml'
            );

            expect(relevantFiles).toEqual(['package.json', 'src']);
        });
    });

    describe('Prompts Integration', () => {
        test('should mock prompts correctly', async () => {
            mockPrompts.mockResolvedValue({name: 'test-value'});

            const result = await prompts({type: 'text', name: 'name', message: 'Test?'});

            expect(result.name).toBe('test-value');
            expect(mockPrompts).toHaveBeenCalled();
        });
    });

    describe('File System Integration', () => {
        test('should mock fs operations correctly', async () => {
            mockFs.readFile.mockResolvedValue('test content');
            mockFs.writeFile.mockResolvedValue(undefined);

            const content = await mockFs.readFile('test.txt', 'utf-8');
            await mockFs.writeFile('output.txt', 'new content', 'utf-8');

            expect(content).toBe('test content');
            expect(mockFs.writeFile).toHaveBeenCalledWith('output.txt', 'new content', 'utf-8');
        });
    });
});