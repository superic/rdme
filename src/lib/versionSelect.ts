import type { Version } from '../cmds/versions';

import config from 'config';
import { Headers } from 'node-fetch';

import APIError from './apiError';
import fetch, { cleanHeaders, handleRes } from './fetch';
import isCI from './isCI';
import { warn } from './logger';
import * as promptHandler from './prompts';
import promptTerminal from './promptWrapper';

/**
 * Validates and returns a project version.
 *
 * @param versionFlag version input parameter
 * @param key project API key
 * @param allowNewVersion if true, goes through prompt flow
 * for creating a new project version
 * @returns a cleaned up project version
 */
export async function getProjectVersion(versionFlag: string, key: string, allowNewVersion: boolean): Promise<string> {
  try {
    if (versionFlag) {
      return await fetch(`${config.get('host')}/api/v1/version/${versionFlag}`, {
        method: 'get',
        headers: cleanHeaders(key),
      })
        .then(res => handleRes(res))
        .then((res: Version) => res.version);
    }

    if (isCI()) {
      warn('No `--version` parameter detected in current CI environment. Defaulting to main version.');
      return undefined;
    }

    const versionList: Version[] = await fetch(`${config.get('host')}/api/v1/version`, {
      method: 'get',
      headers: cleanHeaders(key),
    }).then(res => handleRes(res));

    if (allowNewVersion) {
      const { option, versionSelection, newVersion } = await promptTerminal(promptHandler.generatePrompts(versionList));

      if (option === 'update') return versionSelection;

      const body: Version = {
        from: versionList[0].version,
        version: newVersion,
        is_stable: false,
      };

      const newVersionFromApi = await fetch(`${config.get('host')}/api/v1/version`, {
        method: 'post',
        headers: cleanHeaders(key, new Headers({ 'Content-Type': 'application/json' })),
        body: JSON.stringify(body),
      })
        .then(res => handleRes(res))
        .then((res: Version) => res.version);

      return newVersionFromApi;
    }

    const { versionSelection } = await promptTerminal(promptHandler.generatePrompts(versionList, true));

    return versionSelection;
  } catch (err) {
    return Promise.reject(new APIError(err));
  }
}
