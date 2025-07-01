#!/usr/bin/env node

// src/cli.ts
import prompts from "prompts";
import chalk from "chalk";
import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";
import degit from "tiged";
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
async function main() {
  const pkg = await fs.readJson(path.join(__dirname, "..", "package.json"));
  console.log(chalk.cyan(`\u{1F680} Welcome to gen-from v${pkg.version}!`));
  console.log(chalk.dim(`${pkg.description}
`));
  try {
    const args = process.argv.slice(2);
    if (args.includes("--version") || args.includes("-v")) {
      console.log(pkg.version);
      process.exit(0);
    }
    const templateArg = args[0];
    const isHereFlag = args.includes("--here");
    const config = await loadConfig();
    const selectedTemplate = await selectTemplate(config.templates, templateArg);
    if (!selectedTemplate) {
      console.log(chalk.red("\u274C Template selection cancelled"));
      process.exit(1);
    }
    console.log(chalk.dim(`Checking template: ${selectedTemplate.repo}...`));
    await validateTemplate(selectedTemplate.repo);
    const userInputs = await collectInputs(config.placeholders);
    if (!userInputs) {
      console.log(chalk.red("\u274C Setup cancelled"));
      process.exit(1);
    }
    const packageName = await suggestPackageName(userInputs.USERNAME, userInputs.PROJECT_NAME);
    if (!packageName) {
      console.log(chalk.red("\u274C Setup cancelled"));
      process.exit(1);
    }
    userInputs.PACKAGE_NAME = packageName;
    const targetDir = isHereFlag ? "." : userInputs.PROJECT_NAME;
    if (!isHereFlag && await fs.pathExists(targetDir)) {
      const shouldReplace = await promptForReplacement(targetDir);
      if (!shouldReplace) {
        console.log(chalk.yellow("\u274C Operation cancelled"));
        process.exit(0);
      }
    } else if (isHereFlag) {
      const hasFiles = await hasExistingFiles(".");
      if (hasFiles) {
        const shouldReplace = await promptForReplacement(".", true);
        if (!shouldReplace) {
          console.log(chalk.yellow("\u274C Operation cancelled"));
          process.exit(0);
        }
      }
    }
    await downloadTemplate(selectedTemplate.repo, targetDir);
    await processFiles(targetDir, userInputs);
    console.log(chalk.green("\u2705 Project generated successfully!"));
    console.log(`
${chalk.yellow("Next steps:")}`);
    if (isHereFlag) {
      console.log("  pnpm install");
    } else {
      console.log(`  cd ${userInputs.PROJECT_NAME}`);
      console.log("  pnpm install");
    }
    console.log("  pnpm build");
    console.log("  pnpm test\n");
  } catch (error) {
    console.error(chalk.red("\u274C Error:"), error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
async function loadConfig() {
  const templatesPath = path.join(__dirname, "..", "templates.json");
  const placeholdersPath = path.join(__dirname, "..", "placeholders.json");
  if (!await fs.pathExists(templatesPath)) {
    throw new Error("Templates configuration file not found");
  }
  if (!await fs.pathExists(placeholdersPath)) {
    throw new Error("Placeholders configuration file not found");
  }
  const templates = await fs.readJson(templatesPath);
  const placeholders = await fs.readJson(placeholdersPath);
  return {
    templates,
    placeholders
  };
}
async function selectTemplate(templates, templateArg) {
  if (templateArg) {
    let repoPath;
    if (templateArg.includes("/")) {
      repoPath = templateArg;
    } else {
      repoPath = `phucbm/${templateArg}`;
    }
    const found = templates.find((t) => t.name === templateArg || t.repo === templateArg || t.repo === repoPath);
    if (found) {
      return found;
    }
    return {
      name: templateArg,
      description: `Template from ${repoPath}`,
      repo: repoPath
    };
  }
  console.log(chalk.yellow("Available templates:"));
  const choices = templates.map((template) => ({
    title: `${template.name} - ${chalk.dim(template.description)}`,
    value: template
  }));
  const response = await prompts({
    type: "select",
    name: "template",
    message: "Select a template:",
    choices,
    initial: 0
  });
  return response.template || null;
}
async function validateTemplate(repoName) {
  const response = await fetch(`https://api.github.com/repos/${repoName}`);
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Template repository "${repoName}" not found on GitHub`);
    } else {
      throw new Error(`Failed to verify template repository: ${response.statusText}`);
    }
  }
}
async function collectInputs(placeholders) {
  console.log(chalk.yellow("\nProvide project information:"));
  const questions = placeholders.map((placeholder) => ({
    type: "text",
    name: placeholder.key,
    message: placeholder.prompt,
    initial: placeholder.default,
    validate: (value) => {
      if (placeholder.required && !value.trim()) {
        return `${placeholder.key} is required`;
      }
      return true;
    }
  }));
  const response = await prompts(questions);
  for (const placeholder of placeholders) {
    if (placeholder.required && response[placeholder.key] === void 0) {
      return null;
    }
  }
  return response;
}
async function suggestPackageName(username, projectName) {
  const suggestions = [
    projectName,
    `@${username}/${projectName}`,
    "Use different name"
  ];
  const choices = suggestions.map((suggestion, index) => ({
    title: index === 2 ? chalk.dim(suggestion) : suggestion,
    value: suggestion
  }));
  const response = await prompts({
    type: "select",
    name: "packageName",
    message: "Choose package name:",
    choices,
    initial: 1
    // Default to @username/project-name
  });
  if (!response.packageName) {
    return null;
  }
  if (response.packageName === "Use different name") {
    const customResponse = await prompts({
      type: "text",
      name: "customPackageName",
      message: "Enter package name:",
      initial: `@${username}/${projectName}`,
      validate: (value) => {
        if (!value.trim()) {
          return "Package name is required";
        }
        return true;
      }
    });
    return customResponse.customPackageName || null;
  }
  return response.packageName;
}
async function downloadTemplate(repoName, targetDir) {
  console.log(chalk.dim(`
Downloading template from ${repoName}...`));
  const emitter = degit(repoName, {
    cache: false,
    force: true,
    verbose: false
  });
  try {
    await emitter.clone(targetDir);
    console.log(chalk.green("\u2713 Template downloaded"));
  } catch (error) {
    throw new Error(`Failed to download template: ${error instanceof Error ? error.message : error}`);
  }
}
async function processFiles(targetDir, userInputs) {
  console.log(chalk.dim("\nProcessing template files..."));
  const files = await getAllFiles(targetDir);
  const placeholderStats = {};
  for (const [key, value] of Object.entries(userInputs)) {
    placeholderStats[key] = {
      count: 0,
      replacement: value
    };
  }
  for (const filePath of files) {
    if (!isBinaryFile(filePath)) {
      try {
        const content = await fs.readFile(filePath, "utf-8");
        for (const key of Object.keys(userInputs)) {
          const matches = content.match(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"));
          if (matches) {
            placeholderStats[key].count += matches.length;
          }
        }
      } catch (error) {
      }
    }
  }
  console.log(chalk.yellow("\nPlaceholder replacement summary:"));
  let hasReplacements = false;
  for (const [key, stats] of Object.entries(placeholderStats)) {
    if (stats.count > 0) {
      console.log(chalk.cyan(`  ${key}`) + chalk.dim(` => Found ${stats.count} occurrence${stats.count === 1 ? "" : "s"} => Replacing with `) + chalk.green(`"${stats.replacement}"`));
      hasReplacements = true;
    }
  }
  if (!hasReplacements) {
    console.log(chalk.dim("  No placeholders found in template files"));
  }
  console.log("");
  let filesProcessed = 0;
  for (const filePath of files) {
    const wasModified = await processFile(filePath, userInputs);
    if (wasModified) {
      filesProcessed++;
    }
  }
  if (hasReplacements && filesProcessed > 0) {
    console.log(chalk.green(`\u2713 ${filesProcessed} file${filesProcessed === 1 ? "" : "s"} processed`));
  } else {
    console.log(chalk.green("\u2713 Template files copied"));
  }
}
async function getAllFiles(dir) {
  const files = [];
  async function scan(currentDir) {
    const items = await fs.readdir(currentDir);
    for (const item of items) {
      const fullPath = path.join(currentDir, item);
      const stat = await fs.stat(fullPath);
      if (stat.isDirectory()) {
        if (item !== "node_modules" && item !== ".git") {
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
async function processFile(filePath, userInputs) {
  try {
    if (isBinaryFile(filePath)) {
      return false;
    }
    let content = await fs.readFile(filePath, "utf-8");
    let hasChanges = false;
    if (path.basename(filePath) === "package.json") {
      try {
        const packageJson = JSON.parse(content);
        if (packageJson.name && userInputs.PACKAGE_NAME) {
          packageJson.name = userInputs.PACKAGE_NAME;
          hasChanges = true;
        }
        if (packageJson.author && userInputs.USERNAME) {
          packageJson.author = userInputs.USERNAME;
          hasChanges = true;
        }
        if (packageJson.keywords) {
          packageJson.keywords = [
            "typescript",
            "javascript",
            userInputs.PROJECT_NAME.toLowerCase(),
            "utility"
          ];
          hasChanges = true;
        }
        if (packageJson.repository && userInputs.USERNAME && userInputs.PROJECT_NAME) {
          if (typeof packageJson.repository === "string") {
            packageJson.repository = `https://github.com/${userInputs.USERNAME}/${userInputs.PROJECT_NAME}`;
          } else if (packageJson.repository.url) {
            packageJson.repository.url = `https://github.com/${userInputs.USERNAME}/${userInputs.PROJECT_NAME}`;
          }
          hasChanges = true;
        }
        if (packageJson.bugs && userInputs.USERNAME && userInputs.PROJECT_NAME) {
          if (typeof packageJson.bugs === "string") {
            packageJson.bugs = `https://github.com/${userInputs.USERNAME}/${userInputs.PROJECT_NAME}/issues`;
          } else if (packageJson.bugs.url) {
            packageJson.bugs.url = `https://github.com/${userInputs.USERNAME}/${userInputs.PROJECT_NAME}/issues`;
          }
          hasChanges = true;
        }
        if (packageJson.homepage && userInputs.USERNAME && userInputs.PROJECT_NAME) {
          packageJson.homepage = `https://github.com/${userInputs.USERNAME}/${userInputs.PROJECT_NAME}`;
          hasChanges = true;
        }
        if (hasChanges) {
          content = JSON.stringify(packageJson, null, 2);
        }
      } catch (parseError) {
        console.warn(chalk.yellow(`\u26A0 Warning: Could not parse package.json, using string replacement`));
      }
    }
    for (const [key, value] of Object.entries(userInputs)) {
      if (content.includes(key)) {
        content = content.replace(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), value);
        hasChanges = true;
      }
    }
    if (hasChanges) {
      await fs.writeFile(filePath, content, "utf-8");
    }
    return hasChanges;
  } catch (error) {
    console.warn(chalk.yellow(`\u26A0 Warning: Could not process file ${filePath}: ${error}`));
    return false;
  }
}
function isBinaryFile(filePath) {
  const binaryExtensions = [
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".ico",
    ".svg",
    ".pdf",
    ".zip",
    ".tar",
    ".gz",
    ".7z",
    ".exe",
    ".dll",
    ".so",
    ".dylib",
    ".woff",
    ".woff2",
    ".ttf",
    ".otf"
  ];
  const ext = path.extname(filePath).toLowerCase();
  return binaryExtensions.includes(ext);
}
async function promptForReplacement(targetPath, isCurrentDir = false) {
  const message = isCurrentDir ? "Current directory contains files. This will overwrite existing files. Continue?" : `Directory "${targetPath}" already exists. This will overwrite existing files. Continue?`;
  const response = await prompts({
    type: "confirm",
    name: "replace",
    message,
    initial: false
  });
  return response.replace || false;
}
async function hasExistingFiles(dir) {
  try {
    const items = await fs.readdir(dir);
    const relevantFiles = items.filter(
      (item) => !item.startsWith(".") && item !== "node_modules" && item !== "package-lock.json" && item !== "yarn.lock" && item !== "pnpm-lock.yaml"
    );
    return relevantFiles.length > 0;
  } catch {
    return false;
  }
}
main().catch(console.error);
