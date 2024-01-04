import type ChangelogsCommand from '../cmds/changelogs.js';
import type CustomPagesCommand from '../cmds/custompages.js';
import type DocsCommand from '../cmds/docs/index.js';

import fs from 'node:fs/promises';
import path from 'node:path';

import chalk from 'chalk';
import { Headers } from 'node-fetch';

import APIError from './apiError.js';
import readdirRecursive from './readdirRecursive.js';
import readDoc from './readDoc.js';
import readmeAPIFetch, { cleanHeaders, handleRes } from './readmeAPIFetch.js';

/** API path within ReadMe to update (e.g. `docs`, `changelogs`, etc.) */
type PageType = 'docs' | 'changelogs' | 'custompages';

type PageCommand = DocsCommand | ChangelogsCommand | CustomPagesCommand;

/**
 * Reads the contents of the specified Markdown or HTML file
 * and creates/updates the corresponding doc in ReadMe
 *
 * @returns A promise-wrapped string with the result
 */
async function pushDoc(
  this: PageCommand,
  /** the project version */
  selectedVersion: string | undefined,
  /**
   * path to a single file
   * (**note**: path must be to a single file and NOT a directory)
   */
  filePath: string,
) {
  const type: PageType = this.id;
  const { key, dryRun }: { dryRun: boolean; key: string } = this.flags;

  const { content, data, hash, slug } = readDoc(filePath);

  // TODO: ideally we should offer a zero-configuration approach that doesn't
  // require YAML front matter, but that will have to be a breaking change
  if (!Object.keys(data).length) {
    this.debug(`No front matter attributes found for ${filePath}, not syncing`);
    return `⏭️  no front matter attributes found for ${filePath}, skipping`;
  }

  let payload: {
    body?: string;
    html?: string;
    htmlmode?: boolean;
    lastUpdatedHash: string;
  } = { body: content, ...data, lastUpdatedHash: hash };

  if (type === 'custompages') {
    if (filePath.endsWith('.html')) {
      payload = { html: content, htmlmode: true, ...data, lastUpdatedHash: hash };
    } else {
      payload = { body: content, htmlmode: false, ...data, lastUpdatedHash: hash };
    }
  }

  function createDoc() {
    if (dryRun) {
      return `🎭 dry run! This will create '${slug}' with contents from ${filePath} with the following metadata: ${JSON.stringify(
        data,
      )}`;
    }

    return (
      readmeAPIFetch(
        `/api/v1/${type}`,
        {
          method: 'post',
          headers: cleanHeaders(key, selectedVersion, new Headers({ 'Content-Type': 'application/json' })),
          body: JSON.stringify({
            slug,
            ...payload,
          }),
        },
        { filePath, fileType: 'path' },
      )
        .then(handleRes)
        // eslint-disable-next-line no-underscore-dangle
        .then(res => `🌱 successfully created '${res.slug}' (ID: ${res._id}) with contents from ${filePath}`)
    );
  }

  function updateDoc(existingDoc: typeof payload) {
    if (hash === existingDoc.lastUpdatedHash) {
      return `${dryRun ? '🎭 dry run! ' : ''}\`${slug}\` ${
        dryRun ? 'will not be' : 'was not'
      } updated because there were no changes.`;
    }

    if (dryRun) {
      return `🎭 dry run! This will update '${slug}' with contents from ${filePath} with the following metadata: ${JSON.stringify(
        data,
      )}`;
    }

    return readmeAPIFetch(
      `/api/v1/${type}/${slug}`,
      {
        method: 'put',
        headers: cleanHeaders(key, selectedVersion, new Headers({ 'Content-Type': 'application/json' })),
        body: JSON.stringify(payload),
      },
      { filePath, fileType: 'path' },
    )
      .then(handleRes)
      .then(res => `✏️ successfully updated '${res.slug}' with contents from ${filePath}`);
  }

  return readmeAPIFetch(`/api/v1/${type}/${slug}`, {
    method: 'get',
    headers: cleanHeaders(key, selectedVersion, new Headers({ Accept: 'application/json' })),
  })
    .then(async res => {
      const body = await handleRes(res, false);
      if (!res.ok) {
        if (res.status !== 404) return Promise.reject(new APIError(body));
        this.debug(`error retrieving data for ${slug}, creating doc`);
        return createDoc();
      }
      this.debug(`data received for ${slug}, updating doc`);
      return updateDoc(body);
    })
    .catch(err => {
      // eslint-disable-next-line no-param-reassign
      err.message = `Error uploading ${chalk.underline(filePath)}:\n\n${err.message}`;
      throw err;
    });
}

/**
 * Takes a path (either to a directory of files or to a single file)
 * and syncs those (either via POST or PUT) to ReadMe.
 * @returns A promise-wrapped string with the results
 */
export default async function syncDocsPath(
  this: PageCommand,
  /** ReadMe project version */
  selectedVersion?: string,
) {
  const { path: pathInput }: { path: string } = this.args;

  const allowedFileExtensions = ['.markdown', '.md'];
  // we allow HTML files in custom pages
  if (this.id === 'custompages') {
    allowedFileExtensions.unshift('.html');
  }

  const stat = await fs.stat(pathInput).catch(err => {
    if (err.code === 'ENOENT') {
      throw new Error("Oops! We couldn't locate a file or directory at the path you provided.");
    }
    throw err;
  });

  let output: string;

  if (stat.isDirectory()) {
    // Filter out any files that don't match allowedFileExtensions
    const files = readdirRecursive(pathInput).filter(file =>
      allowedFileExtensions.includes(path.extname(file).toLowerCase()),
    );

    this.debug(`number of files: ${files.length}`);

    if (!files.length) {
      return Promise.reject(
        new Error(
          `The directory you provided (${pathInput}) doesn't contain any of the following required files: ${allowedFileExtensions.join(
            ', ',
          )}.`,
        ),
      );
    }

    output = (
      await Promise.all(
        files.map(async filename => {
          return pushDoc.call(this, selectedVersion, filename);
        }),
      )
    ).join('\n');
  } else {
    const fileExtension = path.extname(pathInput).toLowerCase();
    if (!allowedFileExtensions.includes(fileExtension)) {
      return Promise.reject(
        new Error(
          `Invalid file extension (${fileExtension}). Must be one of the following: ${allowedFileExtensions.join(
            ', ',
          )}`,
        ),
      );
    }
    output = await pushDoc.call(this, selectedVersion, pathInput);
  }
  return Promise.resolve(chalk.green(output));
}
