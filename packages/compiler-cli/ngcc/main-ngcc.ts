#!/usr/bin/env node
/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import * as yargs from 'yargs';

import {resolve, setFileSystem, CachedFileSystem, NodeJSFileSystem} from '../src/ngtsc/file_system';
import {mainNgcc} from './src/main';
import {ConsoleLogger, LogLevel} from './src/logging/console_logger';

// CLI entry point
if (require.main === module) {
  const startTime = Date.now();

  const args = process.argv.slice(2);
  const options =
      yargs
          .option('s', {
            alias: 'source',
            describe:
                'A path (relative to the working directory) of the `node_modules` folder to process.',
            default: './node_modules'
          })
          .option('f', {alias: 'formats', hidden: true, array: true})
          .option('p', {
            alias: 'properties',
            array: true,
            describe:
                'An array of names of properties in package.json to compile (e.g. `module` or `es2015`)\n' +
                'Each of these properties should hold the path to a bundle-format.\n' +
                'If provided, only the specified properties are considered for processing.\n' +
                'If not provided, all the supported format properties (e.g. fesm2015, fesm5, es2015, esm2015, esm5, main, module) in the package.json are considered.'
          })
          .option('t', {
            alias: 'target',
            describe:
                'A relative path (from the `source` path) to a single entry-point to process (plus its dependencies).',
          })
          .option('first-only', {
            describe:
                'If specified then only the first matching package.json property will be compiled.',
            type: 'boolean'
          })
          .option('create-ivy-entry-points', {
            describe:
                'If specified then new `*_ivy_ngcc` entry-points will be added to package.json rather than modifying the ones in-place.\n' +
                'For this to work you need to have custom resolution set up (e.g. in webpack) to look for these new entry-points.\n' +
                'The Angular CLI does this already, so it is safe to use this option if the project is being built via the CLI.',
            type: 'boolean'
          })
          .option('l', {
            alias: 'loglevel',
            describe: 'The lowest severity logging message that should be output.',
            choices: ['debug', 'info', 'warn', 'error'],
          })
          .help()
          .parse(args);

  if (options['f'] && options['f'].length) {
    console.error(
        'The formats option (-f/--formats) has been removed. Consider the properties option (-p/--properties) instead.');
    process.exit(1);
  }

  setFileSystem(new CachedFileSystem(new NodeJSFileSystem()));

  const baseSourcePath = resolve(options['s'] || './node_modules');
  const propertiesToConsider: string[] = options['p'];
  const targetEntryPointPath = options['t'] ? options['t'] : undefined;
  const compileAllFormats = !options['first-only'];
  const createNewEntryPointFormats = options['create-ivy-entry-points'];
  const logLevel = options['l'] as keyof typeof LogLevel | undefined;

  (async() => {
    try {
      const logger = logLevel && new ConsoleLogger(LogLevel[logLevel]);

      await mainNgcc({
        basePath: baseSourcePath,
        propertiesToConsider,
        targetEntryPointPath,
        compileAllFormats,
        createNewEntryPointFormats,
        logger,
        async: true,
      });

      if (logger) {
        const duration = Math.round((Date.now() - startTime) / 1000);
        logger.debug(`Run ngcc in ${duration}s.`);
      }

      process.exitCode = 0;
    } catch (e) {
      console.error(e.stack || e.message);
      process.exitCode = 1;
    }
  })();
}
