import type { Config } from '@oclif/core';

import nock from 'nock';
import prompts from 'prompts';
import { describe, beforeAll, beforeEach, afterAll, it, expect } from 'vitest';

import getAPIMock, { getAPIMockWithVersionHeader } from '../../helpers/get-api-mock.js';
import setupOclifConfig from '../../helpers/setup-oclif-config.js';

const fixturesBaseDir = '__fixtures__/docs';

const key = 'API_KEY';
const version = '1.0.0';

describe('rdme docs:prune', () => {
  const folder = `./__tests__/${fixturesBaseDir}/delete-docs`;
  let oclifConfig: Config;
  let run: (args?: string[]) => Promise<unknown>;

  beforeAll(() => {
    nock.disableNetConnect();
  });

  beforeEach(async () => {
    oclifConfig = await setupOclifConfig();
    run = (args?: string[]) => oclifConfig.runCommand('docs:prune', args);
  });

  afterAll(() => nock.cleanAll());

  it('should error if no folder provided', () => {
    return expect(run(['--key', key, '--version', version])).rejects.rejects.toThrow('Missing 1 required arg:\nfolder');
  });

  it('should error if the argument is not a folder', async () => {
    const versionMock = getAPIMock().get(`/api/v1/version/${version}`).basicAuth({ user: key }).reply(200, { version });

    await expect(run(['--key', key, '--version', version, 'not-a-folder'])).rejects.toThrow(
      "ENOENT: no such file or directory, scandir 'not-a-folder'",
    );

    versionMock.done();
  });

  it('should do nothing if the user aborted', async () => {
    prompts.inject([false]);

    const versionMock = getAPIMock().get(`/api/v1/version/${version}`).basicAuth({ user: key }).reply(200, { version });

    await expect(run([folder, '--key', key, '--version', version])).rejects.toStrictEqual(
      new Error('Aborting, no changes were made.'),
    );

    versionMock.done();
  });

  it('should not ask for user confirmation if `confirm` is set to true', async () => {
    const versionMock = getAPIMock().get(`/api/v1/version/${version}`).basicAuth({ user: key }).reply(200, { version });

    const apiMocks = getAPIMockWithVersionHeader(version)
      .get('/api/v1/categories?perPage=20&page=1')
      .basicAuth({ user: key })
      .reply(200, [{ slug: 'category1', type: 'guide' }], { 'x-total-count': '1' })
      .get('/api/v1/categories/category1/docs')
      .basicAuth({ user: key })
      .reply(200, [{ slug: 'this-doc-should-be-missing-in-folder' }, { slug: 'some-doc' }])
      .delete('/api/v1/docs/this-doc-should-be-missing-in-folder')
      .basicAuth({ user: key })
      .reply(204, '');

    await expect(run([folder, '--key', key, '--version', version, '--confirm'])).resolves.toBe(
      '🗑️  successfully deleted `this-doc-should-be-missing-in-folder`.',
    );

    apiMocks.done();
    versionMock.done();
  });

  it('should delete doc if file is missing', async () => {
    prompts.inject([true]);

    const versionMock = getAPIMock().get(`/api/v1/version/${version}`).basicAuth({ user: key }).reply(200, { version });

    const apiMocks = getAPIMockWithVersionHeader(version)
      .get('/api/v1/categories?perPage=20&page=1')
      .basicAuth({ user: key })
      .reply(200, [{ slug: 'category1', type: 'guide' }], { 'x-total-count': '1' })
      .get('/api/v1/categories/category1/docs')
      .basicAuth({ user: key })
      .reply(200, [{ slug: 'this-doc-should-be-missing-in-folder' }, { slug: 'some-doc' }])
      .delete('/api/v1/docs/this-doc-should-be-missing-in-folder')
      .basicAuth({ user: key })
      .reply(204, '');

    await expect(run([folder, '--key', key, '--version', version])).resolves.toBe(
      '🗑️  successfully deleted `this-doc-should-be-missing-in-folder`.',
    );

    apiMocks.done();
    versionMock.done();
  });

  it('should delete doc and its child if they are missing', async () => {
    prompts.inject([true]);

    const versionMock = getAPIMock().get(`/api/v1/version/${version}`).basicAuth({ user: key }).reply(200, { version });

    const apiMocks = getAPIMockWithVersionHeader(version)
      .get('/api/v1/categories?perPage=20&page=1')
      .basicAuth({ user: key })
      .reply(200, [{ slug: 'category1', type: 'guide' }], { 'x-total-count': '1' })
      .get('/api/v1/categories/category1/docs')
      .basicAuth({ user: key })
      .reply(200, [
        { slug: 'this-doc-should-be-missing-in-folder', children: [{ slug: 'this-child-is-also-missing' }] },
        { slug: 'some-doc' },
      ])
      .delete('/api/v1/docs/this-doc-should-be-missing-in-folder')
      .basicAuth({ user: key })
      .reply(204, '')
      .delete('/api/v1/docs/this-child-is-also-missing')
      .basicAuth({ user: key })
      .reply(204, '');

    await expect(run([folder, '--key', key, '--version', version])).resolves.toBe(
      '🗑️  successfully deleted `this-child-is-also-missing`.\n🗑️  successfully deleted `this-doc-should-be-missing-in-folder`.',
    );

    apiMocks.done();
    versionMock.done();
  });

  it('should return doc delete info for dry run', async () => {
    prompts.inject([true]);

    const versionMock = getAPIMock().get(`/api/v1/version/${version}`).basicAuth({ user: key }).reply(200, { version });
    const apiMocks = getAPIMockWithVersionHeader(version)
      .get('/api/v1/categories?perPage=20&page=1')
      .basicAuth({ user: key })
      .reply(200, [{ slug: 'category1', type: 'guide' }], { 'x-total-count': '1' })
      .get('/api/v1/categories/category1/docs')
      .basicAuth({ user: key })
      .reply(200, [{ slug: 'this-doc-should-be-missing-in-folder' }]);

    await expect(run([folder, '--key', key, '--version', version, '--dryRun'])).resolves.toBe(
      '🎭 dry run! This will delete `this-doc-should-be-missing-in-folder`.',
    );

    apiMocks.done();
    versionMock.done();
  });

  describe('rdme guides:prune', () => {
    it('should error if no folder provided', () => {
      return expect(oclifConfig.runCommand('guides:prune', ['--key', key, '--version', version])).rejects.toThrow(
        'Missing 1 required arg:\nfolder',
      );
    });
  });
});
