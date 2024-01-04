import type { Analysis, AnalyzedFeature } from '../../lib/analyzeOas.js';
import type { OASDocument } from 'oas/types';

import { Args, Flags } from '@oclif/core';
import chalk from 'chalk';
import ora from 'ora';
import pluralize from 'pluralize';
import { getBorderCharacters, table } from 'table';

import analyzeOas, { getSupportedFeatures } from '../../lib/analyzeOas.js';
import BaseCommand from '../../lib/baseCommandNew.js';
import { titleFlag, workingDirectoryFlag } from '../../lib/flags.js';
import { oraOptions } from '../../lib/logger.js';
import prepareOas from '../../lib/prepareOas.js';
import SoftError from '../../lib/softError.js';

function getFeatureDocsURL(feature: AnalyzedFeature, definitionVersion: string): string | undefined {
  if (!feature.url) {
    return undefined;
  }

  if (typeof feature.url === 'object') {
    // We don't need to do any Swagger or Postman determination here because this command
    // always converts their spec to OpenAPI 3.0.
    if (definitionVersion.startsWith('3.0')) {
      return feature.url?.['3.0'] || 'This feature is not available on OpenAPI v3.0.';
    } else if (definitionVersion.startsWith('3.1')) {
      return feature.url?.['3.1'] || 'This feature is not available on OpenAPI v3.1.';
    }
    return '';
  }

  return feature.url;
}

function buildFeaturesReport(analysis: Analysis, features: string[]) {
  let hasUnusedFeature = false;
  const report: string[] = [
    // Minor bit of padding between the top of our report and the "analyzing your spec" messaging.
    '',
  ];

  features.forEach(feature => {
    if (feature in analysis.openapi) {
      const info = analysis.openapi[feature as keyof Analysis['openapi']];
      if (!info.present) {
        // If our last report entry was an unused feature we should add an empty line in the
        // report to give everything some room to breathe.
        if (report.length && report[report.length - 1].length) {
          report.push('');
        }

        report.push(`${feature}: You do not use this.`);
        hasUnusedFeature = true;
      } else {
        report.push('');
        report.push(`${feature}:`);
        report.push(...(info.locations as string[]).map(loc => ` · ${chalk.yellow(loc)}`));
      }
    }
  });

  if (features.includes('readme')) {
    // Add some spacing between our OpenAPI and ReadMe extension reports (but only if our last
    // entry wasn't an empty line).
    if (features.length > 1 && report[report.length - 1].length) {
      report.push('');
    }

    Object.entries(analysis.readme).forEach(([feature, info]) => {
      if (!info.present) {
        report.push(`${feature}: You do not use this.`);
        hasUnusedFeature = true;
      } else {
        report.push(`${feature}:`);
        report.push(...(info.locations as string[]).map(loc => ` · ${chalk.yellow(loc)}`));
        report.push('');
      }
    });
  }

  // Because we add a little bit of padding between our report and the "analyzing your spec" copy
  // if this second entry in the report is an empty line then we can safely remove it so we don't
  // end up with multiple empty lines at the top of our report.
  if (!report[1].length) {
    report.splice(0, 1);
  }

  // If the last entry in our report array is an empty string then we should remove it.
  if (!report[report.length - 1].length) {
    report.pop();
  }

  return {
    report: report.join('\n'),
    hasUnusedFeature,
  };
}

function buildFullReport(analysis: Analysis, definitionVersion: string, tableBorder: Record<string, string>) {
  const report: string[] = ['Here are some interesting things we found in your API definition. 🕵️', ''];

  // General API definition statistics
  Object.entries(analysis.general).forEach(([, info]) => {
    let msg: string;

    if (Array.isArray(info.found)) {
      if (!info.found.length) {
        return;
      }

      const highlightedData = info.found.map(d => chalk.yellow(d));
      if (info.found.length > 1) {
        msg = `You are using ${chalk.bold(info.found.length)} ${pluralize(
          info.name,
          info.found.length,
        )} throughout your API: ${new Intl.ListFormat('en').format(highlightedData)}`;
      } else {
        msg = `You are using a single ${info.name} throughout your API: ${highlightedData[0]}`;
      }
    } else if (info.found > 1) {
      msg = `You have a total of ${chalk.bold(info.found)} ${pluralize(info.name, info.found)} in your API.`;
      if (info.found > 100) {
        msg += ' Wow!';
      }
    } else {
      msg = `You have a single ${info.name} in your API.`;
    }

    report.push(` · ${msg}`);
  });

  // Build out a view of all OpenAPI and ReadMe features that we discovered.
  [
    { component: 'openapi', header: 'OpenAPI Features' },
    { component: 'readme', header: 'ReadMe-Specific Features and Extensions' },
  ].forEach(({ component, header }: { component: string; header: string }) => {
    const tableData: string[][] = [
      [chalk.bold.green('Feature'), chalk.bold.green('Used?'), chalk.bold.green('Description')],
    ];

    Object.entries(analysis[component as 'openapi' | 'readme']).forEach(([feature, info]) => {
      const descriptions: string[] = [];
      if (info.description) {
        descriptions.push(info.description);
      }

      const url = getFeatureDocsURL(info, definitionVersion);
      if (url) {
        descriptions.push(chalk.grey(url));
      }

      tableData.push([feature, info.present ? '✅' : '', descriptions.join('\n\n')]);
    });

    report.push('');
    report.push(header);
    report.push(
      table(tableData, {
        border: tableBorder,
        columns: {
          2: {
            width: 80,
            wrapWord: true,
          },
        },
      }),
    );
  });

  return report.join('\n');
}

export default class OpenAPIInspectCommand extends BaseCommand<typeof OpenAPIInspectCommand> {
  static description = 'Analyze an OpenAPI/Swagger definition for various OpenAPI and ReadMe feature usage.';

  static args = {
    spec: Args.string({ description: 'A file/URL to your API definition' }),
  };

  static flags = {
    feature: Flags.string({
      description:
        'A specific OpenAPI or ReadMe feature you wish to see detailed information on (if it exists). If any features supplied do not exist within the API definition an exit(1) code will be returned alongside the report.',
      multiple: true,
      options: getSupportedFeatures(),
    }),
    title: titleFlag,
    workingDirectory: workingDirectoryFlag,
  };

  async run() {
    const { spec } = this.args;
    const { workingDirectory, feature: features } = this.flags;

    const tableBorder = Object.entries(getBorderCharacters('norc'))
      .map(([border, char]) => ({ [border]: chalk.gray(char) }))
      .reduce((prev, next) => Object.assign(prev, next));

    if (workingDirectory) {
      const previousWorkingDirectory = process.cwd();
      process.chdir(workingDirectory);
      this.debug(`switching working directory from ${previousWorkingDirectory} to ${process.cwd()}`);
    }

    const { preparedSpec, definitionVersion } = await prepareOas(spec, 'openapi:inspect', { convertToLatest: true });
    const parsedPreparedSpec: OASDocument = JSON.parse(preparedSpec);

    const spinner = ora({ ...oraOptions() });
    if (features?.length) {
      spinner.start(
        `Analyzing your API definition for usage of ${new Intl.ListFormat('en').format(
          features.map(feature => (feature === 'readme' ? 'ReadMe extensions' : feature)),
        )}...`,
      );
    } else {
      spinner.start('Analyzing your API definition for OpenAPI and ReadMe feature usage...');
    }

    const analysis = await analyzeOas(parsedPreparedSpec).catch(err => {
      this.debug(`analyzer err: ${err.message}`);
      spinner.fail();
      throw err;
    });

    if (features?.length) {
      spinner.succeed(`${spinner.text} done! ✅`);
      const { report, hasUnusedFeature } = buildFeaturesReport(analysis, features);
      if (hasUnusedFeature) {
        // If we have any unused features we should reject the command with a soft error so we
        // output the report as normal but return a `exit(1)` status code.
        return Promise.reject(new SoftError(report));
      }

      return Promise.resolve(report);
    }

    spinner.stop();

    return Promise.resolve(buildFullReport(analysis, definitionVersion.version, tableBorder));
  }
}
