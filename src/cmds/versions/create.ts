import type { Version } from './index.js';

import { Args, Flags } from '@oclif/core';
import { Headers } from 'node-fetch';
import prompts from 'prompts';
import semver from 'semver';

import BaseCommand from '../../lib/baseCommandNew.js';
import castStringOptToBool from '../../lib/castStringOptToBool.js';
import { baseVersionFlags, keyFlag } from '../../lib/flags.js';
import * as promptHandler from '../../lib/prompts.js';
import promptTerminal from '../../lib/promptWrapper.js';
import readmeAPIFetch, { cleanHeaders, handleRes } from '../../lib/readmeAPIFetch.js';

export interface Options extends CommonOptions {
  fork?: string;
}

export interface CommonOptions {
  beta?: 'true' | 'false';
  codename?: string;
  deprecated?: 'true' | 'false';
  hidden?: 'true' | 'false';
  main?: 'true' | 'false';
}

export default class CreateVersionCommand extends BaseCommand<typeof CreateVersionCommand> {
  static description = 'Create a new version for your project.';

  static args = {
    version: Args.string({
      description: "The version you'd like to create. Must be valid SemVer (https://semver.org/)",
      required: true,
    }),
  };

  static flags = {
    fork: Flags.string({ description: "The semantic version which you'd like to fork from." }),
    key: keyFlag,
    ...baseVersionFlags,
  };

  async run(): Promise<string> {
    let versionList;
    const { version } = this.args;
    const { key, fork, codename, main, beta, deprecated, hidden } = this.flags;

    if (!semver.valid(semver.coerce(version))) {
      return Promise.reject(
        new Error(`Please specify a semantic version. See \`${this.config.bin} help ${this.id}\` for help.`),
      );
    }

    if (!fork) {
      versionList = await readmeAPIFetch('/api/v1/version', {
        method: 'get',
        headers: cleanHeaders(key),
      }).then(handleRes);
    }

    prompts.override({
      from: fork,
      is_beta: castStringOptToBool(beta, 'beta'),
      is_deprecated: castStringOptToBool(deprecated, 'deprecated'),
      is_hidden: castStringOptToBool(hidden, 'hidden'),
      is_stable: castStringOptToBool(main, 'main'),
    });

    const promptResponse = await promptTerminal(promptHandler.versionPrompt(versionList || []));

    const body: Version = {
      codename,
      version,
      from: promptResponse.from,
      is_beta: promptResponse.is_beta,
      is_deprecated: promptResponse.is_deprecated,
      is_hidden: promptResponse.is_hidden,
      is_stable: promptResponse.is_stable,
    };

    return readmeAPIFetch('/api/v1/version', {
      method: 'post',
      headers: cleanHeaders(
        key,
        undefined,
        new Headers({ Accept: 'application/json', 'Content-Type': 'application/json' }),
      ),
      body: JSON.stringify(body),
    })
      .then(handleRes)
      .then(() => {
        return Promise.resolve(`Version ${version} created successfully.`);
      });
  }
}
