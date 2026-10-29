export type ConfigErrorCode =
  | 'CONFIGURATION_ROOT_INVALID'
  | 'CONFIGURATION_ENVIRONMENT_ROOT_INVALID'
  | 'CONFIGURATION_PATH_INVALID'
  | 'CONFIGURATION_FILE_INVALID'
  | 'CONFIGURATION_FILE_NOT_FOUND';

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
