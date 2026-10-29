export type ConfigSource = 'application' | 'home' | 'environment';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export interface ConfigResolutionOptions {
  /** Absolute source directory containing the application .config directory. */
  readonly applicationSourceDirectory: string;

  /** Slug used to construct the user configuration directory: ~/.<appSlug>. */
  readonly appSlug: string;

  /** Environment variable containing the optional highest-precedence root. */
  readonly environmentVariable?: string;

  /** Testable home directory override. Defaults to os.homedir(). */
  readonly homeDirectory?: string;

  /** Testable environment override. Defaults to process.env. */
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

export interface ConfigJsonOptions extends ConfigResolutionOptions {
  /** Relative JSON file path layered across all resolved configuration roots. */
  readonly relativePath?: string;
}

export interface ConfigRoot {
  readonly source: ConfigSource;
  readonly directory: string;
  readonly exists: boolean;
}

export interface ResolvedConfigFile {
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly source: ConfigSource;
  readonly sourceDirectory: string;
}

export interface ResolvedConfigJsonLayer extends ResolvedConfigFile {
  readonly value: JsonObject;
}

export interface ResolvedConfigJson {
  readonly relativePath: string;
  readonly value: JsonObject;
  readonly layers: readonly ResolvedConfigJsonLayer[];
}

export interface ConfigResolution {
  readonly roots: readonly ConfigRoot[];
  readonly searchOrder: readonly ConfigRoot[];
  readonly selectedFiles: readonly ResolvedConfigFile[];
}
