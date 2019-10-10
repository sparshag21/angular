/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import {parseSync, transformFromAstSync} from '@babel/core';
import {extname, join} from 'path';

import {Diagnostics} from '../../diagnostics';
import {FileUtils} from '../../file_utils';
import {OutputPathFn} from '../output_path';
import {TranslationBundle, TranslationHandler} from '../translator';

import {makeEs2015TranslatePlugin} from './es2015_translate_plugin';
import {makeEs5TranslatePlugin} from './es5_translate_plugin';
import {TranslatePluginOptions} from './source_file_utils';

/**
 * Translate a file by inlining all messages tagged by `$localize` with the appropriate translated
 * message.
 */
export class SourceFileTranslationHandler implements TranslationHandler {
  constructor(private translationOptions: TranslatePluginOptions = {}) {}

  canTranslate(relativeFilePath: string, contents: Buffer): boolean {
    return extname(relativeFilePath) === '.js';
  }

  translate(
      diagnostics: Diagnostics, sourceRoot: string, relativeFilePath: string, contents: Buffer,
      outputPathFn: OutputPathFn, translations: TranslationBundle[]): void {
    const sourceCode = contents.toString('utf8');
    // A short-circuit check to avoid parsing the file into an AST if it does not contain any
    // `$localize` identifiers.
    if (!sourceCode.includes('$localize')) {
      for (const translation of translations) {
        FileUtils.writeFile(outputPathFn(translation.locale, relativeFilePath), contents);
      }
    } else {
      const ast = parseSync(sourceCode, {sourceRoot, filename: relativeFilePath});
      if (!ast) {
        diagnostics.error(`Unable to parse source file: ${join(sourceRoot, relativeFilePath)}`);
        return;
      }
      for (const translationBundle of translations) {
        const translated = transformFromAstSync(ast, sourceCode, {
          compact: true,
          generatorOpts: {minified: true},
          plugins: [
            makeEs2015TranslatePlugin(
                diagnostics, translationBundle.translations, this.translationOptions),
            makeEs5TranslatePlugin(
                diagnostics, translationBundle.translations, this.translationOptions),
          ],
          filename: relativeFilePath,
        });
        if (translated && translated.code) {
          FileUtils.writeFile(
              outputPathFn(translationBundle.locale, relativeFilePath), translated.code);
        } else {
          diagnostics.error(
              `Unable to translate source file: ${join(sourceRoot, relativeFilePath)}`);
          return;
        }
      }
    }
  }
}
