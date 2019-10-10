/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import * as ts from 'typescript';

import {isFatalDiagnosticError} from '../../../src/ngtsc/diagnostics';
import {AbsoluteFsPath, absoluteFromSourceFile, relative} from '../../../src/ngtsc/file_system';
import {Decorator} from '../../../src/ngtsc/reflection';
import {DecoratorHandler, DetectResult, HandlerPrecedence} from '../../../src/ngtsc/transform';
import {NgccClassSymbol} from '../host/ngcc_host';

import {AnalyzedClass, MatchingHandler} from './types';

export function isWithinPackage(packagePath: AbsoluteFsPath, sourceFile: ts.SourceFile): boolean {
  return !relative(packagePath, absoluteFromSourceFile(sourceFile)).startsWith('..');
}

export function analyzeDecorators(
    classSymbol: NgccClassSymbol, decorators: Decorator[] | null,
    handlers: DecoratorHandler<any, any>[]): AnalyzedClass|null {
  const declaration = classSymbol.declaration.valueDeclaration;
  const matchingHandlers = handlers
                               .map(handler => {
                                 const detected = handler.detect(declaration, decorators);
                                 return {handler, detected};
                               })
                               .filter(isMatchingHandler);

  if (matchingHandlers.length === 0) {
    return null;
  }
  const detections: {handler: DecoratorHandler<any, any>, detected: DetectResult<any>}[] = [];
  let hasWeakHandler: boolean = false;
  let hasNonWeakHandler: boolean = false;
  let hasPrimaryHandler: boolean = false;

  for (const {handler, detected} of matchingHandlers) {
    if (hasNonWeakHandler && handler.precedence === HandlerPrecedence.WEAK) {
      continue;
    } else if (hasWeakHandler && handler.precedence !== HandlerPrecedence.WEAK) {
      // Clear all the WEAK handlers from the list of matches.
      detections.length = 0;
    }
    if (hasPrimaryHandler && handler.precedence === HandlerPrecedence.PRIMARY) {
      throw new Error(`TODO.Diagnostic: Class has multiple incompatible Angular decorators.`);
    }

    detections.push({handler, detected});
    if (handler.precedence === HandlerPrecedence.WEAK) {
      hasWeakHandler = true;
    } else if (handler.precedence === HandlerPrecedence.SHARED) {
      hasNonWeakHandler = true;
    } else if (handler.precedence === HandlerPrecedence.PRIMARY) {
      hasNonWeakHandler = true;
      hasPrimaryHandler = true;
    }
  }

  const matches: {handler: DecoratorHandler<any, any>, analysis: any}[] = [];
  const allDiagnostics: ts.Diagnostic[] = [];
  for (const {handler, detected} of detections) {
    try {
      const {analysis, diagnostics} = handler.analyze(declaration, detected.metadata);
      if (diagnostics !== undefined) {
        allDiagnostics.push(...diagnostics);
      }
      matches.push({handler, analysis});
    } catch (e) {
      if (isFatalDiagnosticError(e)) {
        allDiagnostics.push(e.toDiagnostic());
      } else {
        throw e;
      }
    }
  }
  return {
    name: classSymbol.name,
    declaration,
    decorators,
    matches,
    diagnostics: allDiagnostics.length > 0 ? allDiagnostics : undefined
  };
}

function isMatchingHandler<A, M>(handler: Partial<MatchingHandler<A, M>>):
    handler is MatchingHandler<A, M> {
  return !!handler.detected;
}
