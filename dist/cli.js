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
  console.log(chalk.cyan("\u{1F680} Welcome to gen-from!"));
  console.log(chalk.dim("Generate projects from GitHub template repositories\n"));
  try {
    const args = process.argv.slice(2);
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
    const targetDir = isHereFlag ? "." : userInputs.PROJECT_NAME;
    if (!isHereFlag && await fs.pathExists(targetDir)) {
      throw new Error(`Directory ${targetDir} already exists`);
    }
    await downloadTemplate(selectedTemplate.repo, targetDir);
    await processFiles(targetDir, userInputs);
    console.log(chalk.green("\u2705 Project generated successfully!"));
    console.log(`
${chalk.yellow("Next steps:")}`);
    if (isHereFlag) {
      console.log("  npm install");
    } else {
      console.log(`  cd ${userInputs.PROJECT_NAME}`);
      console.log("  npm install");
    }
    console.log("  npm run build");
    console.log("  npm test\n");
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
    const found = templates.find((t) => t.name === templateArg || t.repo === templateArg);
    if (!found) {
      console.log(chalk.red(`\u274C Template "${templateArg}" not found`));
      console.log(chalk.yellow("Available templates:"));
      templates.forEach((t) => {
        console.log(`  \u2022 ${chalk.cyan(t.name)} - ${chalk.dim(t.description)}`);
      });
      return null;
    }
    return found;
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
  const questions = placeholders.map((placeholder) => {
    let defaultValue = placeholder.default;
    return {
      type: "text",
      name: placeholder.key,
      message: placeholder.prompt,
      initial: defaultValue,
      validate: (value) => {
        if (placeholder.required && !value.trim()) {
          return `${placeholder.key} is required`;
        }
        return true;
      }
    };
  });
  const results = {};
  for (const question of questions) {
    if (question.initial?.includes("{{") && results.PROJECT_NAME) {
      question.initial = question.initial.replace("{{PROJECT_NAME}}", results.PROJECT_NAME);
    }
    const response = await prompts(question);
    if (response[question.name] === void 0) {
      return null;
    }
    results[question.name] = response[question.name];
  }
  return results;
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
  console.log(chalk.dim("Processing template files..."));
  const files = await getAllFiles(targetDir);
  for (const filePath of files) {
    await processFile(filePath, userInputs);
  }
  console.log(chalk.green("\u2713 Files processed"));
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
      return;
    }
    let content = await fs.readFile(filePath, "utf-8");
    let hasChanges = false;
    for (const [key, value] of Object.entries(userInputs)) {
      const placeholder = `{{${key}}}`;
      if (content.includes(placeholder)) {
        let replacement = value;
        if (key === "KEYWORDS" && typeof value === "string") {
          if (filePath.endsWith("package.json")) {
            const keywords = value.split(",").map((k) => k.trim()).filter((k) => k);
            replacement = JSON.stringify(keywords).slice(1, -1);
          }
        }
        content = content.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), replacement);
        hasChanges = true;
      }
    }
    if (hasChanges) {
      await fs.writeFile(filePath, content, "utf-8");
    }
  } catch (error) {
    console.warn(chalk.yellow(`\u26A0 Warning: Could not process file ${filePath}: ${error}`));
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
main().catch(console.error);
