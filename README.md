# gen-from

[![Publish on Release](https://github.com/phucbm/gen-from/actions/workflows/publish.yml/badge.svg)](https://github.com/phucbm/gen-from/actions/workflows/publish.yml)
[![npm version](https://badgen.net/npm/v/gen-from?icon=npm)](https://www.npmjs.com/package/gen-from)
[![npm downloads](https://badgen.net/npm/dm/gen-from?icon=npm)](https://www.npmjs.com/package/gen-from)
[![npm dependents](https://badgen.net/npm/dependents/gen-from?icon=npm)](https://www.npmjs.com/package/gen-from)
[![github stars](https://badgen.net/github/stars/phucbm/gen-from?icon=github)](https://github.com/phucbm/gen-from/)
[![github license](https://badgen.net/github/license/phucbm/gen-from?icon=github)](https://github.com/phucbm/gen-from/blob/main/LICENSE)
[![Made in Vietnam](https://raw.githubusercontent.com/webuild-community/badge/master/svg/made.svg)](https://webuild.community)

CLI tool to generate projects from GitHub template repositories using tiged.

## Installation

```bash
npm install -g gen-from
```

Or use directly with npx:

```bash
npx gen-from
```

## Usage

### Interactive mode (recommended)
```bash
npx gen-from
```
Shows a list of available templates to choose from.

### Direct template selection
```bash
npx gen-from npm-utils-template
```

### Generate in current directory
```bash
npx gen-from npm-utils-template --here
```

## How it works

1. **Template Selection**: Choose from configured templates or specify directly
2. **Validation**: Checks if the template repository exists on GitHub
3. **Information Collection**: Prompts for project details (name, author, description, etc.)
4. **Download**: Uses tiged to download the latest template files (fast, no git history)
5. **Processing**: Replaces placeholders with your provided information
6. **Ready**: Your project is ready to use!

## Template Placeholders

The following placeholders are automatically replaced in template files:

- `{{PROJECT_NAME}}` - Project directory name
- `{{PACKAGE_NAME}}` - NPM package name
- `{{USERNAME}}` - GitHub username
- `{{AUTHOR_NAME}}` - Author full name
- `{{DESCRIPTION}}` - Package description
- `{{KEYWORDS}}` - Keywords (comma-separated)
- `{{LICENSE}}` - License type

## Configuration

Templates are configured in `templates.json`. You can add your own templates by:

1. Adding entries to the `templates` array
2. Specifying the GitHub repository path
3. Templates should use the placeholder format above

Example template entry:
```json
{
  "name": "my-template",
  "description": "My awesome template",
  "repo": "username/my-template-repo"
}
```

## Creating Templates

1. Create a GitHub repository with your template files
2. Use placeholders like `{{PACKAGE_NAME}}` in your template files
3. Add your template to the configuration
4. The template will be available in the CLI

## Examples

```bash
# Interactive template selection
npx gen-from

# Generate from specific template
npx gen-from npm-utils-template

# Generate in current directory
npx gen-from react-component-template --here
```

## Requirements

- Node.js >= 16
- Git (for tiged to work)

## License

MIT © [phucbm](https://github.com/phucbm)
