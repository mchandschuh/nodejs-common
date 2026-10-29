import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { ConfigError } from './errors.js';
import type {
  ConfigJsonOptions,
  ConfigResolution,
  ConfigResolutionOptions,
  ConfigRoot,
  ConfigSource,
  JsonObject,
  JsonValue,
  ResolvedConfigFile,
  ResolvedConfigJson,
  ResolvedConfigJsonLayer,
} from './types.js';

const DEFAULT_ENVIRONMENT_VARIABLE = 'SDLC_CONFIG';
const APP_SLUG = /^[a-z0-9][a-z0-9-]*$/u;

interface InternalRoot extends ConfigRoot {
  readonly source: ConfigSource;
}

function assertAbsoluteDirectory(value: string, label: string): string {
  if (!isAbsolute(value)) {
    throw new ConfigError('CONFIGURATION_ROOT_INVALID', `${label} must be an absolute path.`, value);
  }
  return resolve(value);
}

function assertAppSlug(appSlug: string): void {
  if (!APP_SLUG.test(appSlug)) {
    throw new ConfigError('CONFIGURATION_ROOT_INVALID', 'appSlug must contain lowercase letters, digits, and hyphens only.', appSlug);
  }
}

async function inspectDirectory(directory: string, source: ConfigSource, required: boolean): Promise<InternalRoot> {
  try {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new ConfigError(
        required ? 'CONFIGURATION_ENVIRONMENT_ROOT_INVALID' : 'CONFIGURATION_ROOT_INVALID',
        `Configuration ${source} root must be a real directory.`,
        directory,
      );
    }
    return { source, directory, exists: true };
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !required) {
      return { source, directory, exists: false };
    }
    throw new ConfigError(
      required ? 'CONFIGURATION_ENVIRONMENT_ROOT_INVALID' : 'CONFIGURATION_ROOT_INVALID',
      `Configuration ${source} root could not be inspected.`,
      directory,
    );
  }
}

export async function resolveConfigRoots(options: ConfigResolutionOptions): Promise<readonly ConfigRoot[]> {
  assertAppSlug(options.appSlug);
  const applicationDirectory = resolve(assertAbsoluteDirectory(options.applicationSourceDirectory, 'applicationSourceDirectory'), '.config');
  const homeDirectory = resolve(assertAbsoluteDirectory(options.homeDirectory ?? homedir(), 'homeDirectory'), `.${options.appSlug}`);
  const environmentVariable = options.environmentVariable ?? DEFAULT_ENVIRONMENT_VARIABLE;
  const environment = options.environment ?? process.env;
  const roots: InternalRoot[] = [
    await inspectDirectory(applicationDirectory, 'application', false),
    await inspectDirectory(homeDirectory, 'home', false),
  ];
  const environmentValue = environment[environmentVariable];
  if (environmentValue !== undefined) {
    const environmentDirectory = assertAbsoluteDirectory(environmentValue, `${environmentVariable} root`);
    roots.push(await inspectDirectory(environmentDirectory, 'environment', true));
  }
  return roots;
}

function assertRelativeConfigPath(relativePath: string): string {
  if (!relativePath || isAbsolute(relativePath) || relativePath.split(/[\\/]/u).includes('..')) {
    throw new ConfigError('CONFIGURATION_PATH_INVALID', 'Configuration file paths must be non-empty relative paths without parent traversal.', relativePath);
  }
  return relativePath.split('\\').join('/');
}

function contained(root: string, candidate: string): boolean {
  const remainder = relative(root, candidate);
  return remainder === '' || (remainder !== '..' && !remainder.startsWith(`..${sep}`) && !isAbsolute(remainder));
}

async function safeConfigFile(root: ConfigRoot, relativePath: string): Promise<ResolvedConfigFile | undefined> {
  if (!root.exists) return undefined;
  const normalized = assertRelativeConfigPath(relativePath);
  const absolutePath = resolve(root.directory, normalized);
  if (!contained(root.directory, absolutePath)) throw new ConfigError('CONFIGURATION_PATH_INVALID', 'Configuration file escapes its root.', relativePath);
  const canonicalRoot = await realpath(root.directory);
  let current = root.directory;
  for (const segment of normalized.split('/')) {
    current = resolve(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new ConfigError('CONFIGURATION_PATH_INVALID', 'Symbolic-link configuration paths are not permitted.', relativePath);
    } catch (error) {
      if (error instanceof ConfigError) throw error;
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new ConfigError('CONFIGURATION_FILE_INVALID', 'Configuration path could not be inspected.', relativePath);
    }
  }
  let info;
  try {
    info = await lstat(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new ConfigError('CONFIGURATION_FILE_INVALID', 'Configuration file could not be inspected.', relativePath);
  }
  if (!info.isFile()) throw new ConfigError('CONFIGURATION_FILE_INVALID', 'Configuration path must be a regular file.', relativePath);
  const canonicalPath = await realpath(absolutePath);
  if (!contained(canonicalRoot, canonicalPath)) throw new ConfigError('CONFIGURATION_PATH_INVALID', 'Configuration file resolves outside its root.', relativePath);
  return { relativePath: normalized, absolutePath: canonicalPath, source: root.source, sourceDirectory: root.directory };
}

export async function resolveConfigFile(relativePath: string, options: ConfigResolutionOptions): Promise<ResolvedConfigFile | undefined> {
  const normalized = assertRelativeConfigPath(relativePath);
  const roots = await resolveConfigRoots(options);
  for (const root of [...roots].reverse()) {
    const result = await safeConfigFile(root, normalized);
    if (result) return result;
  }
  return undefined;
}

function isJsonObject(value: JsonValue | unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function defineJsonProperty(target: Record<string, JsonValue>, key: string, value: JsonValue): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function cloneJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map((entry) => cloneJsonValue(entry));
  if (!isJsonObject(value)) return value;
  const result: Record<string, JsonValue> = {};
  for (const key of Object.keys(value)) defineJsonProperty(result, key, cloneJsonValue(value[key]));
  return result;
}

function mergeJsonObjects(base: JsonObject, overlay: JsonObject): JsonObject {
  const result = cloneJsonValue(base) as JsonObject;
  const target = result as Record<string, JsonValue>;
  for (const key of Object.keys(overlay)) {
    const current = result[key];
    const next = overlay[key];
    defineJsonProperty(target, key, isJsonObject(current) && isJsonObject(next) ? mergeJsonObjects(current, next) : cloneJsonValue(next));
  }
  return result;
}

async function readJsonLayer(file: ResolvedConfigFile): Promise<JsonObject> {
  let text: string;
  try {
    text = await readFile(file.absolutePath, 'utf8');
  } catch {
    throw new ConfigError('CONFIGURATION_FILE_INVALID', 'Configuration JSON file could not be read.', file.relativePath);
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new ConfigError('CONFIGURATION_JSON_INVALID', 'Configuration file does not contain valid JSON.', file.relativePath);
  }
  if (!isJsonObject(value)) {
    throw new ConfigError('CONFIGURATION_JSON_ROOT_INVALID', 'Configuration JSON root must be an object.', file.relativePath);
  }
  return value;
}

export async function resolveConfigJson(options: ConfigJsonOptions): Promise<ResolvedConfigJson> {
  const relativePath = assertRelativeConfigPath(options.relativePath ?? 'config.json');
  const roots = await resolveConfigRoots(options);
  const layers: ResolvedConfigJsonLayer[] = [];
  let value: JsonObject | undefined;
  for (const root of roots) {
    const file = await safeConfigFile(root, relativePath);
    if (!file) continue;
    const layer = await readJsonLayer(file);
    layers.push({ ...file, value: cloneJsonValue(layer) as JsonObject });
    value = value === undefined ? cloneJsonValue(layer) as JsonObject : mergeJsonObjects(value, layer);
  }
  if (!value) {
    throw new ConfigError('CONFIGURATION_FILE_NOT_FOUND', 'No configuration JSON file was found in the resolved roots.', relativePath);
  }
  return { relativePath, value, layers };
}

async function filesUnder(root: ConfigRoot, directory: string, output: ResolvedConfigFile[]): Promise<void> {
  const entries = (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const absolute = resolve(directory, entry.name);
    const relativePath = relative(root.directory, absolute).split(sep).join('/');
    if (entry.isDirectory()) await filesUnder(root, absolute, output);
    else if (entry.isFile()) {
      const result = await safeConfigFile(root, relativePath);
      if (result) output.push(result);
    } else if (entry.isSymbolicLink()) {
      throw new ConfigError('CONFIGURATION_PATH_INVALID', 'Symbolic-link configuration entries are not permitted.', relativePath);
    }
  }
}

export async function inspectConfig(options: ConfigResolutionOptions): Promise<ConfigResolution> {
  const roots = await resolveConfigRoots(options);
  const selected = new Map<string, ResolvedConfigFile>();
  for (const root of roots) {
    if (!root.exists) continue;
    const files: ResolvedConfigFile[] = [];
    await filesUnder(root, root.directory, files);
    for (const file of files) selected.set(file.relativePath, file);
  }
  return { roots, searchOrder: roots, selectedFiles: [...selected.values()].sort((left, right) => left.relativePath.localeCompare(right.relativePath)) };
}
