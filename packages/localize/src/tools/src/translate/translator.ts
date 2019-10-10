/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import {ɵMessageId, ɵParsedTranslation} from '@angular/localize';
import {relative} from 'path';

import {Diagnostics} from '../diagnostics';
import {FileUtils} from '../file_utils';

import {OutputPathFn} from './output_path';



/**
 * An object that holds translations that have been loaded
 * from a translation file.
 */
export interface TranslationBundle {
  locale: string;
  translations: Record<ɵMessageId, ɵParsedTranslation>;
}

/**
 * Implement this interface to provide a class that can handle translation for the given resource in
 * an appropriate manner.
 *
 * For example, source code files will need to be transformed if they contain `$localize` tagged
 * template strings, while most static assets will just need to be copied.
 */
export interface TranslationHandler {
  /**
   * Returns true if the given file can be translated by this handler.
   *
   * @param relativeFilePath A relative path from the sourceRoot to the resource file to handle.
   * @param contents The contents of the file to handle.
   */
  canTranslate(relativeFilePath: string, contents: Buffer): boolean;

  /**
   * Translate the file at `relativeFilePath` containing `contents`, using the given `translations`,
   * and write the translated content to the path computed by calling `outputPathFn()`.
   *
   * @param diagnostics An object for collecting translation diagnostic messages.
   * @param sourceRoot An absolute path to the root of the files being translated.
   * @param relativeFilePath A relative path from the sourceRoot to the file to translate.
   * @param contents The contents of the file to translate.
   * @param outputPathFn A function that returns an absolute path where the output file should be
   * written.
   * @param translations A collection of translations to apply to this file.
   */
  translate(
      diagnostics: Diagnostics, sourceRoot: string, relativeFilePath: string, contents: Buffer,
      outputPathFn: OutputPathFn, translations: TranslationBundle[]): void;
}

/**
 * Translate each file (e.g. source file or static asset) using the given `TranslationHandler`s.
 * The file will be translated by the first handler that returns true for `canTranslate()`.
 */
export class Translator {
  constructor(private resourceHandlers: TranslationHandler[], private diagnostics: Diagnostics) {}

  translateFiles(
      inputPaths: string[], rootPath: string, outputPathFn: OutputPathFn,
      translations: TranslationBundle[]): void {
    inputPaths.forEach(inputPath => {
      const contents = FileUtils.readFileBuffer(inputPath);
      const relativePath = relative(rootPath, inputPath);
      for (const resourceHandler of this.resourceHandlers) {
        if (resourceHandler.canTranslate(relativePath, contents)) {
          return resourceHandler.translate(
              this.diagnostics, rootPath, relativePath, contents, outputPathFn, translations);
        }
      }
      this.diagnostics.error(`Unable to handle resource file: ${inputPath}`);
    });
  }
}
