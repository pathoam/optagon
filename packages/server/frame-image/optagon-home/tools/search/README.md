# Search Tools

Fast code search and file finding. Use these instead of grep/find.

## ripgrep (rg) - Search File Contents

### Basic Search
```bash
rg "pattern"                    # Search all files
rg "TODO"                       # Find TODOs
rg "function.*login"            # Regex search
```

### Filter by File Type
```bash
rg "useState" --type ts         # TypeScript only
rg "def " --type py             # Python only
rg "class" --type js            # JavaScript only
rg "struct" --type rust         # Rust only
```

### Common Options
```bash
rg -i "pattern"                 # Case insensitive
rg -w "word"                    # Whole word only
rg -l "pattern"                 # List files only (no content)
rg -c "pattern"                 # Count matches per file
rg -A 3 "pattern"               # Show 3 lines after match
rg -B 3 "pattern"               # Show 3 lines before match
rg -C 3 "pattern"               # Show 3 lines context (before+after)
```

### Exclude Patterns
```bash
rg "pattern" -g '!*.test.ts'    # Exclude test files
rg "pattern" -g '!dist/*'       # Exclude dist directory
rg "pattern" --hidden           # Include hidden files
```

### Examples
```bash
# Find all API endpoints
rg "app\.(get|post|put|delete)\(" --type ts

# Find React components using a hook
rg "useEffect" --type tsx

# Find imports of a module
rg "from ['\"]express['\"]"

# Find error handling
rg "catch|throw|Error" --type js

# Find environment variable usage
rg "process\.env\."
```

## fd - Find Files by Name

### Basic Search
```bash
fd "pattern"                    # Find files matching pattern
fd "config"                     # Find files with "config" in name
fd "\.json$"                    # Find all JSON files
```

### Filter by Type
```bash
fd -t f "pattern"               # Files only
fd -t d "pattern"               # Directories only
fd -e ts                        # Only .ts files
fd -e py                        # Only .py files
```

### Common Options
```bash
fd -H "pattern"                 # Include hidden files
fd -I "pattern"                 # Don't ignore gitignore
fd -a "pattern"                 # Absolute paths
fd -d 2 "pattern"               # Max depth 2
```

### Examples
```bash
# Find all TypeScript files
fd -e ts

# Find config files
fd "config" -e json -e yaml -e yml

# Find test files
fd "\.test\." -e ts -e js

# Find components
fd -t d "components"

# Find by exact name
fd -g "package.json"
```

## Combining Tools

```bash
# Find files then search in them
fd -e ts | xargs rg "pattern"

# Find large files
fd -t f -x stat -c '%s %n' {} | sort -n | tail -10

# Search and replace (preview)
rg "oldPattern" -l | xargs -I {} echo "Would edit: {}"
```

## Quick Reference

| Task | Command |
|------|---------|
| Find text in code | `rg "text"` |
| Find in specific files | `rg "text" --type ts` |
| Find files by name | `fd "name"` |
| Find by extension | `fd -e json` |
| Case insensitive | `rg -i "text"` |
| List matching files | `rg -l "text"` |
| Show context | `rg -C 3 "text"` |

## Why Not grep/find?

- **rg** auto-ignores `.gitignore` patterns and `node_modules`
- **rg** is 10-100x faster than grep on large codebases
- **fd** has simpler syntax than find
- **fd** also respects `.gitignore`

These are pre-installed. Just use them.
