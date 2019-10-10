/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

/// <reference types="node" />

import {DepGraph} from 'dependency-graph';
import * as os from 'os';
import * as ts from 'typescript';

import {AbsoluteFsPath, FileSystem, absoluteFrom, dirname, getFileSystem, resolve} from '../../src/ngtsc/file_system';

import {CommonJsDependencyHost} from './dependencies/commonjs_dependency_host';
import {DependencyResolver, InvalidEntryPoint, PartiallyOrderedEntryPoints, SortedEntryPointsInfo} from './dependencies/dependency_resolver';
import {EsmDependencyHost} from './dependencies/esm_dependency_host';
import {ModuleResolver} from './dependencies/module_resolver';
import {UmdDependencyHost} from './dependencies/umd_dependency_host';
import {DirectoryWalkerEntryPointFinder} from './entry_point_finder/directory_walker_entry_point_finder';
import {TargetedEntryPointFinder} from './entry_point_finder/targeted_entry_point_finder';
import {AnalyzeEntryPointsFn, CreateCompileFn, Executor, PartiallyOrderedTasks, Task, TaskProcessingOutcome, TaskQueue} from './execution/api';
import {ClusterExecutor} from './execution/cluster/executor';
import {ClusterPackageJsonUpdater} from './execution/cluster/package_json_updater';
import {AsyncSingleProcessExecutor, SingleProcessExecutor} from './execution/single_process_executor';
import {ParallelTaskQueue} from './execution/task_selection/parallel_task_queue';
import {SerialTaskQueue} from './execution/task_selection/serial_task_queue';
import {ConsoleLogger, LogLevel} from './logging/console_logger';
import {Logger} from './logging/logger';
import {hasBeenProcessed, markAsProcessed} from './packages/build_marker';
import {NgccConfiguration} from './packages/configuration';
import {EntryPoint, EntryPointJsonProperty, EntryPointPackageJson, SUPPORTED_FORMAT_PROPERTIES, getEntryPointFormat} from './packages/entry_point';
import {makeEntryPointBundle} from './packages/entry_point_bundle';
import {Transformer} from './packages/transformer';
import {PathMappings} from './utils';
import {FileWriter} from './writing/file_writer';
import {InPlaceFileWriter} from './writing/in_place_file_writer';
import {NewEntryPointFileWriter} from './writing/new_entry_point_file_writer';
import {DirectPackageJsonUpdater, PackageJsonUpdater} from './writing/package_json_updater';


/**
 * The options to configure the ngcc compiler for synchronous execution.
 */
export interface SyncNgccOptions {
  /** The absolute path to the `node_modules` folder that contains the packages to process. */
  basePath: string;

  /**
   * The path to the primary package to be processed. If not absolute then it must be relative to
   * `basePath`.
   *
   * All its dependencies will need to be processed too.
   */
  targetEntryPointPath?: string;

  /**
   * Which entry-point properties in the package.json to consider when processing an entry-point.
   * Each property should hold a path to the particular bundle format for the entry-point.
   * Defaults to all the properties in the package.json.
   */
  propertiesToConsider?: string[];

  /**
   * Whether to process all formats specified by (`propertiesToConsider`)  or to stop processing
   * this entry-point at the first matching format. Defaults to `true`.
   */
  compileAllFormats?: boolean;

  /**
   * Whether to create new entry-points bundles rather than overwriting the original files.
   */
  createNewEntryPointFormats?: boolean;

  /**
   * Provide a logger that will be called with log messages.
   */
  logger?: Logger;

  /**
   * Paths mapping configuration (`paths` and `baseUrl`), as found in `ts.CompilerOptions`.
   * These are used to resolve paths to locally built Angular libraries.
   */
  pathMappings?: PathMappings;

  /**
   * Provide a file-system service that will be used by ngcc for all file interactions.
   */
  fileSystem?: FileSystem;

  /**
   * Whether the compilation should run and return asynchronously. Allowing asynchronous execution
   * may speed up the compilation by utilizing multiple CPU cores (if available).
   *
   * Default: `false` (i.e. run synchronously)
   */
  async?: false;
}

/**
 * The options to configure the ngcc compiler for asynchronous execution.
 */
export type AsyncNgccOptions = Omit<SyncNgccOptions, 'async'>& {async: true};

/**
 * The options to configure the ngcc compiler.
 */
export type NgccOptions = AsyncNgccOptions | SyncNgccOptions;

const EMPTY_GRAPH = new DepGraph<EntryPoint>();

/**
 * This is the main entry-point into ngcc (aNGular Compatibility Compiler).
 *
 * You can call this function to process one or more npm packages, to ensure
 * that they are compatible with the ivy compiler (ngtsc).
 *
 * @param options The options telling ngcc what to compile and how.
 */
export function mainNgcc(options: AsyncNgccOptions): Promise<void>;
export function mainNgcc(options: SyncNgccOptions): void;
export function mainNgcc(
    {basePath, targetEntryPointPath, propertiesToConsider = SUPPORTED_FORMAT_PROPERTIES,
     compileAllFormats = true, createNewEntryPointFormats = false,
     logger = new ConsoleLogger(LogLevel.info), pathMappings, async = false}: NgccOptions): void|
    Promise<void> {
  // Execute in parallel, if async execution is acceptable and there are more than 1 CPU cores.
  const inParallel = async && (os.cpus().length > 1);

  // Instantiate common utilities that are always used.
  // NOTE: Avoid eagerly instantiating anything that might not be used when running sync/async or in
  //       master/worker process.
  const fileSystem = getFileSystem();
  // NOTE: To avoid file corruption, ensure that each `ngcc` invocation only creates _one_ instance
  //       of `PackageJsonUpdater` that actually writes to disk (across all processes).
  //       This is hard to enforce automatically, when running on multiple processes, so needs to be
  //       enforced manually.
  const pkgJsonUpdater = getPackageJsonUpdater(inParallel, fileSystem);

  // The function for performing the analysis.
  const analyzeEntryPoints: AnalyzeEntryPointsFn = () => {
    logger.debug('Analyzing entry-points...');
    const startTime = Date.now();

    const supportedPropertiesToConsider = ensureSupportedProperties(propertiesToConsider);

    const moduleResolver = new ModuleResolver(fileSystem, pathMappings);
    const esmDependencyHost = new EsmDependencyHost(fileSystem, moduleResolver);
    const umdDependencyHost = new UmdDependencyHost(fileSystem, moduleResolver);
    const commonJsDependencyHost = new CommonJsDependencyHost(fileSystem, moduleResolver);
    const dependencyResolver = new DependencyResolver(fileSystem, logger, {
      esm5: esmDependencyHost,
      esm2015: esmDependencyHost,
      umd: umdDependencyHost,
      commonjs: commonJsDependencyHost
    });

    const absBasePath = absoluteFrom(basePath);
    const config = new NgccConfiguration(fileSystem, dirname(absBasePath));
    const {entryPoints, graph} = getEntryPoints(
        fileSystem, pkgJsonUpdater, logger, dependencyResolver, config, absBasePath,
        targetEntryPointPath, pathMappings, supportedPropertiesToConsider, compileAllFormats);

    const unprocessableEntryPointPaths: string[] = [];
    // The tasks are partially ordered by virtue of the entry-points being partially ordered too.
    const tasks: PartiallyOrderedTasks = [] as any;

    for (const entryPoint of entryPoints) {
      const packageJson = entryPoint.packageJson;
      const hasProcessedTypings = hasBeenProcessed(packageJson, 'typings', entryPoint.path);
      const {propertiesToProcess, equivalentPropertiesMap} =
          getPropertiesToProcess(packageJson, supportedPropertiesToConsider, compileAllFormats);
      let processDts = !hasProcessedTypings;

      if (propertiesToProcess.length === 0) {
        // This entry-point is unprocessable (i.e. there is no format property that is of interest
        // and can be processed). This will result in an error, but continue looping over
        // entry-points in order to collect all unprocessable ones and display a more informative
        // error.
        unprocessableEntryPointPaths.push(entryPoint.path);
        continue;
      }

      for (const formatProperty of propertiesToProcess) {
        const formatPropertiesToMarkAsProcessed = equivalentPropertiesMap.get(formatProperty) !;
        tasks.push({entryPoint, formatProperty, formatPropertiesToMarkAsProcessed, processDts});

        // Only process typings for the first property (if not already processed).
        processDts = false;
      }
    }

    // Check for entry-points for which we could not process any format at all.
    if (unprocessableEntryPointPaths.length > 0) {
      throw new Error(
          'Unable to process any formats for the following entry-points (tried ' +
          `${propertiesToConsider.join(', ')}): ` +
          unprocessableEntryPointPaths.map(path => `\n  - ${path}`).join(''));
    }

    const duration = Math.round((Date.now() - startTime) / 1000);
    logger.debug(
        `Analyzed ${entryPoints.length} entry-points in ${duration}s. ` +
        `(Total tasks: ${tasks.length})`);

    return getTaskQueue(inParallel, tasks, graph);
  };

  // The function for creating the `compile()` function.
  const createCompileFn: CreateCompileFn = onTaskCompleted => {
    const fileWriter = getFileWriter(fileSystem, pkgJsonUpdater, createNewEntryPointFormats);
    const transformer = new Transformer(fileSystem, logger);

    return (task: Task) => {
      const {entryPoint, formatProperty, formatPropertiesToMarkAsProcessed, processDts} = task;

      const isCore = entryPoint.name === '@angular/core';  // Are we compiling the Angular core?
      const packageJson = entryPoint.packageJson;
      const formatPath = packageJson[formatProperty];
      const format = getEntryPointFormat(fileSystem, entryPoint, formatProperty);

      // All properties listed in `propertiesToProcess` are guaranteed to point to a format-path
      // (i.e. they are defined in `entryPoint.packageJson`). Furthermore, they are also guaranteed
      // to be among `SUPPORTED_FORMAT_PROPERTIES`.
      // Based on the above, `formatPath` should always be defined and `getEntryPointFormat()`
      // should always return a format here (and not `undefined`).
      if (!formatPath || !format) {
        // This should never happen.
        throw new Error(
            `Invariant violated: No format-path or format for ${entryPoint.path} : ` +
            `${formatProperty} (formatPath: ${formatPath} | format: ${format})`);
      }

      // The format-path which the property maps to is already processed - nothing to do.
      if (hasBeenProcessed(packageJson, formatProperty, entryPoint.path)) {
        logger.debug(`Skipping ${entryPoint.name} : ${formatProperty} (already compiled).`);
        onTaskCompleted(task, TaskProcessingOutcome.AlreadyProcessed);
        return;
      }

      const bundle = makeEntryPointBundle(
          fileSystem, entryPoint, formatPath, isCore, format, processDts, pathMappings, true);

      logger.info(`Compiling ${entryPoint.name} : ${formatProperty} as ${format}`);

      const result = transformer.transform(bundle);
      if (result.success) {
        if (result.diagnostics.length > 0) {
          logger.warn(ts.formatDiagnostics(result.diagnostics, bundle.src.host));
        }
        fileWriter.writeBundle(bundle, result.transformedFiles, formatPropertiesToMarkAsProcessed);
      } else {
        const errors = ts.formatDiagnostics(result.diagnostics, bundle.src.host);
        throw new Error(
            `Failed to compile entry-point ${entryPoint.name} due to compilation errors:\n${errors}`);
      }

      onTaskCompleted(task, TaskProcessingOutcome.Processed);
    };
  };

  // The executor for actually planning and getting the work done.
  const executor = getExecutor(async, inParallel, logger, pkgJsonUpdater);

  return executor.execute(analyzeEntryPoints, createCompileFn);
}

function ensureSupportedProperties(properties: string[]): EntryPointJsonProperty[] {
  // Short-circuit the case where `properties` has fallen back to the default value:
  // `SUPPORTED_FORMAT_PROPERTIES`
  if (properties === SUPPORTED_FORMAT_PROPERTIES) return SUPPORTED_FORMAT_PROPERTIES;

  const supportedProperties: EntryPointJsonProperty[] = [];

  for (const prop of properties as EntryPointJsonProperty[]) {
    if (SUPPORTED_FORMAT_PROPERTIES.indexOf(prop) !== -1) {
      supportedProperties.push(prop);
    }
  }

  if (supportedProperties.length === 0) {
    throw new Error(
        `No supported format property to consider among [${properties.join(', ')}]. ` +
        `Supported properties: ${SUPPORTED_FORMAT_PROPERTIES.join(', ')}`);
  }

  return supportedProperties;
}

function getPackageJsonUpdater(inParallel: boolean, fs: FileSystem): PackageJsonUpdater {
  const directPkgJsonUpdater = new DirectPackageJsonUpdater(fs);
  return inParallel ? new ClusterPackageJsonUpdater(directPkgJsonUpdater) : directPkgJsonUpdater;
}

function getFileWriter(
    fs: FileSystem, pkgJsonUpdater: PackageJsonUpdater,
    createNewEntryPointFormats: boolean): FileWriter {
  return createNewEntryPointFormats ? new NewEntryPointFileWriter(fs, pkgJsonUpdater) :
                                      new InPlaceFileWriter(fs);
}

function getTaskQueue(
    inParallel: boolean, tasks: PartiallyOrderedTasks, graph: DepGraph<EntryPoint>): TaskQueue {
  return inParallel ? new ParallelTaskQueue(tasks, graph) : new SerialTaskQueue(tasks);
}

function getExecutor(
    async: boolean, inParallel: boolean, logger: Logger,
    pkgJsonUpdater: PackageJsonUpdater): Executor {
  if (inParallel) {
    // Execute in parallel (which implies async).
    // Use up to 8 CPU cores for workers, always reserving one for master.
    const workerCount = Math.min(8, os.cpus().length - 1);
    return new ClusterExecutor(workerCount, logger, pkgJsonUpdater);
  } else {
    // Execute serially, on a single thread (either sync or async).
    return async ? new AsyncSingleProcessExecutor(logger, pkgJsonUpdater) :
                   new SingleProcessExecutor(logger, pkgJsonUpdater);
  }
}

function getEntryPoints(
    fs: FileSystem, pkgJsonUpdater: PackageJsonUpdater, logger: Logger,
    resolver: DependencyResolver, config: NgccConfiguration, basePath: AbsoluteFsPath,
    targetEntryPointPath: string | undefined, pathMappings: PathMappings | undefined,
    propertiesToConsider: string[], compileAllFormats: boolean):
    {entryPoints: PartiallyOrderedEntryPoints, graph: DepGraph<EntryPoint>} {
  const {entryPoints, invalidEntryPoints, graph} = (targetEntryPointPath !== undefined) ?
      getTargetedEntryPoints(
          fs, pkgJsonUpdater, logger, resolver, config, basePath, targetEntryPointPath,
          propertiesToConsider, compileAllFormats, pathMappings) :
      getAllEntryPoints(fs, config, logger, resolver, basePath, pathMappings);
  logInvalidEntryPoints(logger, invalidEntryPoints);
  return {entryPoints, graph};
}

function getTargetedEntryPoints(
    fs: FileSystem, pkgJsonUpdater: PackageJsonUpdater, logger: Logger,
    resolver: DependencyResolver, config: NgccConfiguration, basePath: AbsoluteFsPath,
    targetEntryPointPath: string, propertiesToConsider: string[], compileAllFormats: boolean,
    pathMappings: PathMappings | undefined): SortedEntryPointsInfo {
  const absoluteTargetEntryPointPath = resolve(basePath, targetEntryPointPath);
  if (hasProcessedTargetEntryPoint(
          fs, absoluteTargetEntryPointPath, propertiesToConsider, compileAllFormats)) {
    logger.debug('The target entry-point has already been processed');
    return {
      entryPoints: [] as unknown as PartiallyOrderedEntryPoints,
      invalidEntryPoints: [],
      ignoredDependencies: [],
      graph: EMPTY_GRAPH,
    };
  }
  const finder = new TargetedEntryPointFinder(
      fs, config, logger, resolver, basePath, absoluteTargetEntryPointPath, pathMappings);
  const entryPointInfo = finder.findEntryPoints();
  const invalidTarget = entryPointInfo.invalidEntryPoints.find(
      i => i.entryPoint.path === absoluteTargetEntryPointPath);
  if (invalidTarget !== undefined) {
    throw new Error(
        `The target entry-point "${invalidTarget.entryPoint.name}" has missing dependencies:\n` +
        invalidTarget.missingDependencies.map(dep => ` - ${dep}\n`));
  }
  if (entryPointInfo.entryPoints.length === 0) {
    markNonAngularPackageAsProcessed(fs, pkgJsonUpdater, absoluteTargetEntryPointPath);
  }
  return entryPointInfo;
}

function getAllEntryPoints(
    fs: FileSystem, config: NgccConfiguration, logger: Logger, resolver: DependencyResolver,
    basePath: AbsoluteFsPath, pathMappings: PathMappings | undefined): SortedEntryPointsInfo {
  const finder =
      new DirectoryWalkerEntryPointFinder(fs, config, logger, resolver, basePath, pathMappings);
  return finder.findEntryPoints();
}

function hasProcessedTargetEntryPoint(
    fs: FileSystem, targetPath: AbsoluteFsPath, propertiesToConsider: string[],
    compileAllFormats: boolean) {
  const packageJsonPath = resolve(targetPath, 'package.json');
  // It might be that this target is configured in which case its package.json might not exist.
  if (!fs.exists(packageJsonPath)) {
    return false;
  }
  const packageJson = JSON.parse(fs.readFile(packageJsonPath));

  for (const property of propertiesToConsider) {
    if (packageJson[property]) {
      // Here is a property that should be processed
      if (hasBeenProcessed(packageJson, property as EntryPointJsonProperty, targetPath)) {
        if (!compileAllFormats) {
          // It has been processed and we only need one, so we are done.
          return true;
        }
      } else {
        // It has not been processed but we need all of them, so we are done.
        return false;
      }
    }
  }
  // Either all formats need to be compiled and there were none that were unprocessed,
  // Or only the one matching format needs to be compiled but there was at least one matching
  // property before the first processed format that was unprocessed.
  return true;
}

/**
 * If we get here, then the requested entry-point did not contain anything compiled by
 * the old Angular compiler. Therefore there is nothing for ngcc to do.
 * So mark all formats in this entry-point as processed so that clients of ngcc can avoid
 * triggering ngcc for this entry-point in the future.
 */
function markNonAngularPackageAsProcessed(
    fs: FileSystem, pkgJsonUpdater: PackageJsonUpdater, path: AbsoluteFsPath) {
  const packageJsonPath = resolve(path, 'package.json');
  const packageJson = JSON.parse(fs.readFile(packageJsonPath));

  // Note: We are marking all supported properties as processed, even if they don't exist in the
  //       `package.json` file. While this is redundant, it is also harmless.
  markAsProcessed(pkgJsonUpdater, packageJson, packageJsonPath, SUPPORTED_FORMAT_PROPERTIES);
}

function logInvalidEntryPoints(logger: Logger, invalidEntryPoints: InvalidEntryPoint[]): void {
  invalidEntryPoints.forEach(invalidEntryPoint => {
    logger.debug(
        `Invalid entry-point ${invalidEntryPoint.entryPoint.path}.`,
        `It is missing required dependencies:\n` +
            invalidEntryPoint.missingDependencies.map(dep => ` - ${dep}`).join('\n'));
  });
}

/**
 * This function computes and returns the following:
 * - `propertiesToProcess`: An (ordered) list of properties that exist and need to be processed,
 *   based on the provided `propertiesToConsider`, the properties in `package.json` and their
 *   corresponding format-paths. NOTE: Only one property per format-path needs to be processed.
 * - `equivalentPropertiesMap`: A mapping from each property in `propertiesToProcess` to the list of
 *   other format properties in `package.json` that need to be marked as processed as soon as the
 *   former has been processed.
 */
function getPropertiesToProcess(
    packageJson: EntryPointPackageJson, propertiesToConsider: EntryPointJsonProperty[],
    compileAllFormats: boolean): {
  propertiesToProcess: EntryPointJsonProperty[];
  equivalentPropertiesMap: Map<EntryPointJsonProperty, EntryPointJsonProperty[]>;
} {
  const formatPathsToConsider = new Set<string>();

  const propertiesToProcess: EntryPointJsonProperty[] = [];
  for (const prop of propertiesToConsider) {
    const formatPath = packageJson[prop];

    // Ignore properties that are not defined in `package.json`.
    if (typeof formatPath !== 'string') continue;

    // Ignore properties that map to the same format-path as a preceding property.
    if (formatPathsToConsider.has(formatPath)) continue;

    // Process this property, because it is the first one to map to this format-path.
    formatPathsToConsider.add(formatPath);
    propertiesToProcess.push(prop);

    // If we only need one format processed, there is no need to process any more properties.
    if (!compileAllFormats) break;
  }

  const formatPathToProperties: {[formatPath: string]: EntryPointJsonProperty[]} = {};
  for (const prop of SUPPORTED_FORMAT_PROPERTIES) {
    const formatPath = packageJson[prop];

    // Ignore properties that are not defined in `package.json`.
    if (typeof formatPath !== 'string') continue;

    // Ignore properties that do not map to a format-path that will be considered.
    if (!formatPathsToConsider.has(formatPath)) continue;

    // Add this property to the map.
    const list = formatPathToProperties[formatPath] || (formatPathToProperties[formatPath] = []);
    list.push(prop);
  }

  const equivalentPropertiesMap = new Map<EntryPointJsonProperty, EntryPointJsonProperty[]>();
  for (const prop of propertiesToConsider) {
    const formatPath = packageJson[prop] !;
    const equivalentProperties = formatPathToProperties[formatPath];
    equivalentPropertiesMap.set(prop, equivalentProperties);
  }

  return {propertiesToProcess, equivalentPropertiesMap};
}
