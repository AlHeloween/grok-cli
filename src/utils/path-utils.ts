import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { fileURLToPath } from "url";
import { getSettingsManager } from "./settings-manager.js";

/**
 * Find the nearest project root directory (containing .grok folder)
 * by traversing up from the given directory.
 */
export function findProjectRoot(startDir: string = process.cwd()): string | null {
  let current = path.resolve(startDir);
  
  while (current !== path.dirname(current)) {
    const grokDir = path.join(current, ".grok");
    if (fs.existsSync(grokDir) && fs.statSync(grokDir).isDirectory()) {
      return current;
    }
    // Move up one directory
    const parent = path.dirname(current);
    if (parent === current) break; // reached root
    current = parent;
  }
  
  return null;
}

/**
 * Get the installation root directory of the grok-cli package.
 * This works for both development (source) and production (installed) environments.
 */
export function getInstallationRoot(): string {
  // Try multiple strategies to find the installation root
  
  // 1. Use import.meta.url for ES modules
    try {
      if (typeof import.meta !== 'undefined' && import.meta.url) {
        const currentFileUrl = import.meta.url;
        const currentFilePath = fileURLToPath(currentFileUrl);
        // Go up from src/utils/path-utils.ts to package root
        const root = path.resolve(path.dirname(currentFilePath), "../../");
        if (fs.existsSync(root)) {
          return root;
        }
      }
    } catch (_error) { // eslint-disable-line @typescript-eslint/no-unused-vars
      // Continue to next strategy
    }
  
  // 2. Check current directory (development)
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, "src")) && fs.existsSync(path.join(cwd, "package.json"))) {
    return cwd;
  }
  
  // 3. Look for node_modules location by checking __dirname of various entry points
  // This is a heuristic that works for most common installation patterns
  const possibleRoots = [
    cwd,
    path.resolve(cwd, "..", ".."), // node_modules/@vibe-kit/grok-cli
    path.resolve(cwd, ".."), // node_modules/grok-cli
    path.join(os.homedir(), ".grok"), // User data directory
  ];
  
  for (const root of possibleRoots) {
    // Check for package.json or data directory as signature
    const hasPackageJson = fs.existsSync(path.join(root, "package.json"));
    const hasDataDir = fs.existsSync(path.join(root, "data", "glove"));
    if (hasPackageJson || hasDataDir) {
      return root;
    }
  }
  
  // 4. Fallback to user home directory
  return os.homedir();
}

/**
 * Resolve GloVe database path using multi-layered approach:
 * 1. GLOVE_DB_PATH environment variable (absolute path)
 * 2. Project settings (project.rag.aurora.gloveModelPath) resolved relative to project root
 * 3. Default installation location (package installation root)
 * 4. Fallback to test loader (returns null)
 */
export function resolveGlovePath(cwd: string = process.cwd()): string | null {
  // 1. Environment variable override
  if (process.env.GLOVE_DB_PATH) {
    const envPath = path.resolve(process.env.GLOVE_DB_PATH);
    if (fs.existsSync(envPath)) {
      return envPath;
    }
    console.warn(`[path-utils] GLOVE_DB_PATH specified but not found: ${envPath}`);
  }

  // 2. Project settings (try-catch in case settings manager is not available)
  try {
    const settingsManager = getSettingsManager();
    const projectRoot = findProjectRoot(cwd);
    
    if (projectRoot) {
      const gloveModelPath = settingsManager.getRagAuroraGloveModelPath(projectRoot);
      const resolvedPath = path.resolve(projectRoot, gloveModelPath);
      if (fs.existsSync(resolvedPath)) {
        return resolvedPath;
      }
      console.warn(`[path-utils] Project GloVe path not found: ${resolvedPath}`);
    } else {
      // Try with current directory as project root
      const gloveModelPath = settingsManager.getRagAuroraGloveModelPath(cwd);
      const resolvedPath = path.resolve(cwd, gloveModelPath);
      if (fs.existsSync(resolvedPath)) {
        return resolvedPath;
      }
    }
  } catch (error) {
    console.warn(`[path-utils] Could not access settings manager: ${error instanceof Error ? error.message : String(error)}`);
    // Continue to next resolution strategy
  }

  // 3. Default installation location
  const installRoot = getInstallationRoot();
  const defaultPaths = [
    path.join(installRoot, "data", "glove", "glove_50d.db"),
    path.join(installRoot, "node_modules", "@vibe-kit", "grok-cli", "data", "glove", "glove_50d.db"),
    path.join(installRoot, "node_modules", "grok-cli", "data", "glove", "glove_50d.db"),
  ];

  for (const dbPath of defaultPaths) {
    if (fs.existsSync(dbPath)) {
      return dbPath;
    }
  }

  // 4. Not found
  return null;
}

/**
 * Get user data directory for grok-cli (~/.grok/)
 */
export function getUserDataDir(): string {
  return path.join(os.homedir(), ".grok");
}

/**
 * Resolve a path relative to the project root if it's a relative path.
 * If it's an absolute path, return it as-is.
 */
export function resolveProjectPath(relativeOrAbsolutePath: string, cwd: string = process.cwd()): string {
  if (path.isAbsolute(relativeOrAbsolutePath)) {
    return relativeOrAbsolutePath;
  }
  
  const projectRoot = findProjectRoot(cwd) || cwd;
  return path.resolve(projectRoot, relativeOrAbsolutePath);
}

/**
 * Check if a file exists and log helpful message if not.
 */
export function checkFileExists(filePath: string, purpose: string): boolean {
  if (fs.existsSync(filePath)) {
    return true;
  }
  
  console.warn(`[path-utils] ${purpose} file not found: ${filePath}`);
  console.warn(`[path-utils] You may need to generate or download it.`);
  console.warn(`[path-utils] Run 'grok glove generate' or 'grok glove download' to obtain it.`);
  
  return false;
}