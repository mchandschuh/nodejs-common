export type ConfigErrorCode =
  | 'CONFIGURATION_ROOT_INVALID'
  | 'CONFIGURATION_ENVIRONMENT_ROOT_INVALID'
  | 'CONFIGURATION_PATH_INVALID'
  | 'CONFIGURATION_FILE_INVALID'
  | 'CONFIGURATION_FILE_NOT_FOUND'
  | 'CONFIGURATION_JSON_INVALID'
  | 'CONFIGURATION_JSON_ROOT_INVALID';

export class ConfigError extends Error {
  constructor(
    readonly code: ConfigErrorCode,
    message: string,
    readonly path?: string,
  ) {
    super(message);
    this.name = 'ConfigError';
  }
}
