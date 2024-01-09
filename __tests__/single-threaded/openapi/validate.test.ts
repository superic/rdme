/* eslint-disable no-console */
import type { Config } from '@oclif/core';

import fs from 'node:fs';

import chalk from 'chalk';
import prompts from 'prompts';
import { describe, beforeEach, afterEach, it, expect, vi } from 'vitest';

import { after, before } from '../../helpers/get-gha-setup.js';
import setupOclifConfig from '../../helpers/setup-oclif-config.js';

let consoleSpy;

const getCommandOutput = () => {
  return [consoleSpy.mock.calls.join('\n\n')].filter(Boolean).join('\n\n');
};

describe('rdme openapi:validate (single-threaded)', () => {
  let oclifConfig: Config;
  let run: (args?: string[]) => Promise<unknown>;
  let testWorkingDir: string;

  beforeEach(async () => {
    consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    oclifConfig = await setupOclifConfig();
    run = (args?: string[]) => oclifConfig.runCommand('openapi:validate', args);

    testWorkingDir = process.cwd();
  });

  afterEach(() => {
    consoleSpy.mockRestore();

    process.chdir(testWorkingDir);
  });

  it('should discover and upload an API definition if none is provided', async () => {
    await expect(run(['--workingDirectory', './__tests__/__fixtures__/relative-ref-oas'])).resolves.toBe(
      chalk.green('petstore.json is a valid OpenAPI API definition!'),
    );

    expect(console.info).toHaveBeenCalledTimes(1);

    const output = getCommandOutput();
    expect(output).toBe(chalk.yellow('ℹ️  We found petstore.json and are attempting to validate it.'));
  });

  it('should select spec in prompt and validate it', async () => {
    const spec = '__tests__/__fixtures__/petstore-simple-weird-version.json';
    prompts.inject([spec]);
    await expect(run()).resolves.toBe(chalk.green(`${spec} is a valid OpenAPI API definition!`));
  });

  it('should use specified working directory', () => {
    return expect(
      run(['petstore.json', '--workingDirectory', './__tests__/__fixtures__/relative-ref-oas']),
    ).resolves.toBe(chalk.green('petstore.json is a valid OpenAPI API definition!'));
  });

  it('should adhere to .gitignore in subdirectories', () => {
    fs.copyFileSync(
      require.resolve('@readme/oas-examples/3.0/json/petstore-simple.json'),
      './__tests__/__fixtures__/nested-gitignored-oas/nest/petstore-ignored.json',
    );

    return expect(run(['--workingDirectory', './__tests__/__fixtures__/nested-gitignored-oas'])).resolves.toBe(
      chalk.green('nest/petstore.json is a valid OpenAPI API definition!'),
    );
  });

  describe('GHA onboarding E2E tests', () => {
    let yamlOutput;

    beforeEach(() => {
      before((fileName, data) => {
        yamlOutput = data;
      });
    });

    afterEach(() => {
      after();
    });

    it('should create GHA workflow if user passes in spec via opt (including workingDirectory)', async () => {
      expect.assertions(3);
      const spec = 'petstore.json';
      const fileName = 'validate-test-opt-spec-workdir-file';
      prompts.inject([true, 'validate-test-opt-spec-github-branch', fileName]);

      await expect(
        run([spec, '--workingDirectory', './__tests__/__fixtures__/relative-ref-oas']),
      ).resolves.toMatchSnapshot();

      expect(yamlOutput).toMatchSnapshot();
      expect(fs.writeFileSync).toHaveBeenCalledWith(`.github/workflows/${fileName}.yml`, expect.any(String));
    });
  });
});
