import type { CommandOptions } from '../../lib/baseCommand';

import chalk from 'chalk';
import config from 'config';

import Command, { CommandCategories } from '../../lib/baseCommand';
import pushDoc from '../../lib/pushDoc';
import readdirRecursive from '../../lib/readdirRecursive';

export type Options = {
  dryRun?: boolean;
  folder?: string;
};

export default class CustomPagesCommand extends Command {
  constructor() {
    super();

    this.command = 'custompages';
    this.usage = 'custompages <folder> [options]';
    this.description = 'Sync a folder of Markdown files to your ReadMe project as Custom Pages.';
    this.cmdCategory = CommandCategories.CUSTOM_PAGES;
    this.position = 1;

    this.hiddenArgs = ['folder'];
    this.args = [
      {
        name: 'key',
        type: String,
        description: 'Project API key',
      },
      {
        name: 'folder',
        type: String,
        defaultOption: true,
      },
      {
        name: 'dryRun',
        type: Boolean,
        description: 'Runs the command without creating/updating any custom pages in ReadMe. Useful for debugging.',
      },
    ];
  }

  async run(opts: CommandOptions<Options>) {
    super.run(opts, true);

    const { dryRun, folder, key } = opts;

    if (!folder) {
      return Promise.reject(new Error(`No folder provided. Usage \`${config.get('cli')} ${this.usage}\`.`));
    }

    // Strip out non-markdown files
    const files = readdirRecursive(folder).filter(
      file =>
        file.toLowerCase().endsWith('.html') ||
        file.toLowerCase().endsWith('.md') ||
        file.toLowerCase().endsWith('.markdown')
    );

    Command.debug(`number of files: ${files.length}`);

    if (!files.length) {
      return Promise.reject(new Error(`We were unable to locate Markdown or HTML files in ${folder}.`));
    }

    const updatedDocs = await Promise.all(
      files.map(async filename => {
        return pushDoc(key, undefined, dryRun, filename, this.cmdCategory);
      })
    );

    return chalk.green(updatedDocs.join('\n'));
  }
}
