import assert from 'node:assert/strict';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ConfigError } from '../src/config/errors.js';
import { inspectConfig, resolveConfigFile, resolveConfigJson, resolveConfigRoots } from '../src/config/index.js';

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

test('layers application, home, and environment JSON objects in precedence order', async () => {
  const value = await fixture();
  const application = join(value.root, 'src', '.config');
  const home = join(value.home, '.example');
  await mkdir(application, { recursive: true });
  await mkdir(home, { recursive: true });
  await writeFile(join(application, 'config.json'), JSON.stringify({
    llm: { model: 'application-model', thinking: 'medium' },
    limits: { maxIterations: 3 },
    labels: ['application'],
    nullable: 'application',
  }));
  await writeFile(join(home, 'config.json'), JSON.stringify({
    llm: { thinking: 'high' },
    homeOnly: true,
    labels: ['home'],
    nullable: null,
  }));
  await writeFile(join(value.environment, 'config.json'), JSON.stringify({
    llm: { model: 'environment-model' },
    environmentOnly: true,
    labels: ['environment'],
  }));

  const result = await resolveConfigJson(value.options);

  assert.deepEqual(result.value, {
    llm: { model: 'environment-model', thinking: 'high' },
    limits: { maxIterations: 3 },
    labels: ['environment'],
    nullable: null,
    homeOnly: true,
    environmentOnly: true,
  });
  assert.deepEqual(result.layers.map((layer) => layer.source), ['application', 'home', 'environment']);
  assert.deepEqual(result.layers.map((layer) => layer.relativePath), ['config.json', 'config.json', 'config.json']);
});

test('uses config.json by default and succeeds with only an application layer', async () => {
  const value = await fixture();
  const application = join(value.root, 'src', '.config');
  await mkdir(application, { recursive: true });
  await writeFile(join(application, 'config.json'), '{"enabled":true}');

  const result = await resolveConfigJson({ ...value.options, environment: {} });

  assert.equal(result.relativePath, 'config.json');
  assert.deepEqual(result.value, { enabled: true });
  assert.deepEqual(result.layers.map((layer) => layer.source), ['application']);
});

test('fails when no JSON configuration layer exists', async () => {
  const value = await fixture();

  await assert.rejects(
    () => resolveConfigJson({ ...value.options, environment: {} }),
    (error: unknown) => error instanceof ConfigError && error.code === 'CONFIGURATION_FILE_NOT_FOUND',
  );
});

test('fails closed for malformed and non-object JSON layers', async () => {
  const malformed = await fixture();
  const malformedDirectory = join(malformed.root, 'src', '.config');
  await mkdir(malformedDirectory, { recursive: true });
  await writeFile(join(malformedDirectory, 'config.json'), '{"valid":');
  await assert.rejects(
    () => resolveConfigJson({ ...malformed.options, environment: {} }),
    (error: unknown) => error instanceof ConfigError && error.code === 'CONFIGURATION_JSON_INVALID',
  );

  const arrayRoot = await fixture();
  const arrayDirectory = join(arrayRoot.root, 'src', '.config');
  await mkdir(arrayDirectory, { recursive: true });
  await writeFile(join(arrayDirectory, 'config.json'), '["not-an-object"]');
  await assert.rejects(
    () => resolveConfigJson({ ...arrayRoot.options, environment: {} }),
    (error: unknown) => error instanceof ConfigError && error.code === 'CONFIGURATION_JSON_ROOT_INVALID',
  );
});

test('does not mask an invalid lower-precedence layer with a valid higher-precedence layer', async () => {
  const value = await fixture();
  const application = join(value.root, 'src', '.config');
  await mkdir(application, { recursive: true });
  await writeFile(join(application, 'config.json'), '{invalid');
  await writeFile(join(value.environment, 'config.json'), '{"valid":true}');

  await assert.rejects(
    () => resolveConfigJson(value.options),
    (error: unknown) => error instanceof ConfigError && error.code === 'CONFIGURATION_JSON_INVALID',
  );
});

test('supports a custom JSON path while retaining relative-path protection', async () => {
  const value = await fixture();
  const application = join(value.root, 'src', '.config');
  await mkdir(join(application, 'settings'), { recursive: true });
  await writeFile(join(application, 'settings', 'config.json'), '{"custom":true}');

  const result = await resolveConfigJson({ ...value.options, environment: {}, relativePath: 'settings/config.json' });

  assert.deepEqual(result.value, { custom: true });
  await assert.rejects(
    () => resolveConfigJson({ ...value.options, relativePath: '../config.json' }),
    (error: unknown) => error instanceof ConfigError && error.code === 'CONFIGURATION_PATH_INVALID',
  );
});

test('does not allow JSON prototype keys to mutate object prototypes during layering', async () => {
  const value = await fixture();
  const application = join(value.root, 'src', '.config');
  await mkdir(application, { recursive: true });
  await writeFile(join(application, 'config.json'), '{"__proto__":{"polluted":true},"constructor":{"safe":true}}');

  const result = await resolveConfigJson({ ...value.options, environment: {} });

  assert.equal((Object.prototype as { polluted?: boolean }).polluted, undefined);
  assert.deepEqual(result.value['__proto__'], { polluted: true });
  assert.deepEqual(result.value.constructor, { safe: true });
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
