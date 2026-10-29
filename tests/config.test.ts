import assert from 'node:assert/strict';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ConfigError } from '../src/config/errors.js';
import { inspectConfig, resolveConfigFile, resolveConfigRoots } from '../src/config/index.js';

async function fixture() {
  const root = await mkdtemp('/tmp/nodejs-common-config-');
  const home = await mkdtemp('/tmp/nodejs-common-home-');
  const environment = await mkdtemp('/tmp/nodejs-common-env-');
  return { root, home, environment, options: { applicationSourceDirectory: join(root, 'src'), appSlug: 'example', homeDirectory: home, environmentVariable: 'TEST_CONFIG', environment: { TEST_CONFIG: environment } } };
}

test('resolves roots in application, home, and environment precedence order', async () => {
  const value = await fixture();
  await mkdir(join(value.root, 'src', '.config'), { recursive: true });
  await mkdir(join(value.home, '.example'), { recursive: true });
  await writeFile(join(value.root, 'src', '.config', 'settings.json'), 'application');
  await writeFile(join(value.home, '.example', 'settings.json'), 'home');
  await writeFile(join(value.environment, 'settings.json'), 'environment');
  const result = await resolveConfigFile('settings.json', value.options);
  assert.equal(result?.source, 'environment');
  assert.equal(result?.sourceDirectory, value.environment);
});

test('marks optional application and home roots as missing', async () => {
  const value = await fixture();
  const roots = await resolveConfigRoots({ ...value.options, environment: {} });
  assert.deepEqual(roots.map((root) => ({ source: root.source, exists: root.exists })), [
    { source: 'application', exists: false },
    { source: 'home', exists: false },
  ]);
});

test('uses SDLC_CONFIG as the default environment variable', async () => {
  const value = await fixture();
  await writeFile(join(value.environment, 'default.json'), '{}');
  const result = await resolveConfigFile('default.json', {
    ...value.options,
    environmentVariable: undefined,
    environment: { SDLC_CONFIG: value.environment },
  });
  assert.equal(result?.source, 'environment');
});

test('falls back when higher-precedence roots do not contain a file and preserves provenance', async () => {
  const value = await fixture();
  await mkdir(join(value.root, 'src', '.config'), { recursive: true });
  await writeFile(join(value.root, 'src', '.config', 'defaults.json'), '{}');
  const result = await resolveConfigFile('defaults.json', value.options);
  assert.equal(result?.source, 'application');
  assert.equal(result?.relativePath, 'defaults.json');
});

test('requires an environment override to be an absolute existing directory', async () => {
  const value = await fixture();
  await assert.rejects(
    () => resolveConfigRoots({ ...value.options, environment: { TEST_CONFIG: 'relative-config' } }),
    (error: unknown) => error instanceof ConfigError && error.code === 'CONFIGURATION_ROOT_INVALID',
  );
  await assert.rejects(
    () => resolveConfigRoots({ ...value.options, environment: { TEST_CONFIG: '' } }),
    (error: unknown) => error instanceof ConfigError && error.code === 'CONFIGURATION_ROOT_INVALID',
  );
  await assert.rejects(
    () => resolveConfigRoots({ ...value.options, environment: { TEST_CONFIG: join(value.root, 'missing') } }),
    (error: unknown) => error instanceof ConfigError && error.code === 'CONFIGURATION_ENVIRONMENT_ROOT_INVALID',
  );
});

test('rejects absolute paths, traversal, directories, and symlink configuration files', async () => {
  const value = await fixture();
  const application = join(value.root, 'src', '.config');
  await mkdir(application, { recursive: true });
  await mkdir(join(application, 'directory.json'));
  await writeFile(join(application, 'real.json'), '{}');
  await symlink(join(application, 'real.json'), join(application, 'link.json'));
  await assert.rejects(() => resolveConfigFile('/etc/passwd', value.options), /relative paths/);
  await assert.rejects(() => resolveConfigFile('../secret.json', value.options), /relative paths/);
  await assert.rejects(() => resolveConfigFile('directory.json', value.options), (error: unknown) => error instanceof ConfigError && error.code === 'CONFIGURATION_FILE_INVALID');
  await assert.rejects(() => resolveConfigFile('link.json', value.options), (error: unknown) => error instanceof ConfigError && error.code === 'CONFIGURATION_PATH_INVALID');
});

test('inspectConfig returns the highest-precedence file once with source provenance', async () => {
  const value = await fixture();
  const application = join(value.root, 'src', '.config');
  await mkdir(application, { recursive: true });
  await mkdir(join(value.home, '.example'), { recursive: true });
  await writeFile(join(application, 'shared.json'), 'application');
  await writeFile(join(value.home, '.example', 'shared.json'), 'home');
  await writeFile(join(value.environment, 'environment-only.json'), 'environment');
  const result = await inspectConfig(value.options);
  assert.deepEqual(result.selectedFiles.map((file: { readonly relativePath: string; readonly source: string }) => [file.relativePath, file.source]), [
    ['environment-only.json', 'environment'],
    ['shared.json', 'home'],
  ]);
});

test('default home directory is used when no override is supplied', async () => {
  const result = await resolveConfigRoots({ applicationSourceDirectory: '/tmp/example/src', appSlug: 'example', environment: {} });
  assert.equal(result[1]?.directory, join(homedir(), '.example'));
});
