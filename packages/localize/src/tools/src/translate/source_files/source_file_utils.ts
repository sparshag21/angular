/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import {ɵParsedTranslation, ɵisMissingTranslationError, ɵmakeTemplateObject, ɵtranslate} from '@angular/localize';
import {NodePath} from '@babel/traverse';
import * as t from '@babel/types';
import {Diagnostics} from '../../diagnostics';

/**
 * Is the given `expression` an identifier with the correct name
 * @param expression The expression to check.
 */
export function isNamedIdentifier(
    expression: NodePath<t.Expression>, name: string): expression is NodePath<t.Identifier> {
  return expression.isIdentifier() && expression.node.name === name;
}

/**
* Is the given `identifier` declared globally.
* @param identifier The identifier to check.
*/
export function isGlobalIdentifier(identifier: NodePath<t.Identifier>) {
  return !identifier.scope || !identifier.scope.hasBinding(identifier.node.name);
}

/**
* Build a translated expression to replace the call to `$localize`.
* @param messageParts The static parts of the message.
* @param substitutions The expressions to substitute into the message.
*/
export function buildLocalizeReplacement(
    messageParts: TemplateStringsArray, substitutions: readonly t.Expression[]): t.Expression {
  let mappedString: t.Expression = t.stringLiteral(messageParts[0]);
  for (let i = 1; i < messageParts.length; i++) {
    mappedString =
        t.binaryExpression('+', mappedString, wrapInParensIfNecessary(substitutions[i - 1]));
    mappedString = t.binaryExpression('+', mappedString, t.stringLiteral(messageParts[i]));
  }
  return mappedString;
}

/**
* Extract the message parts from the given `call` (to `$localize`).
*
* The message parts will either by the first argument to the `call` or it will be wrapped in call
* to a helper function like `__makeTemplateObject`.
*
* @param call The AST node of the call to process.
*/
export function unwrapMessagePartsFromLocalizeCall(call: t.CallExpression): TemplateStringsArray {
  let cooked = call.arguments[0];
  if (!t.isExpression(cooked)) {
    throw new BabelParseError(call, 'Unexpected argument to `$localize`: ' + cooked);
  }

  // If there is no call to `__makeTemplateObject(...)`, then `raw` must be the same as `cooked`.
  let raw = cooked;

  // Check for cached call of the form `x || x = __makeTemplateObject(...)`
  if (t.isLogicalExpression(cooked) && cooked.operator === '||' && t.isIdentifier(cooked.left) &&
      t.isExpression(cooked.right)) {
    if (t.isAssignmentExpression(cooked.right)) {
      cooked = cooked.right.right;
    }
  }

  // Check for `__makeTemplateObject(cooked, raw)` call
  if (t.isCallExpression(cooked)) {
    raw = cooked.arguments[1] as t.Expression;
    if (!t.isExpression(raw)) {
      throw new BabelParseError(
          raw,
          'Unexpected `raw` argument to the "makeTemplateObject()" function (expected an expression).');
    }
    cooked = cooked.arguments[0];
    if (!t.isExpression(cooked)) {
      throw new BabelParseError(
          cooked,
          'Unexpected `cooked` argument to the "makeTemplateObject()" function (expected an expression).');
    }
  }

  const cookedStrings = unwrapStringLiteralArray(cooked);
  const rawStrings = unwrapStringLiteralArray(raw);
  return ɵmakeTemplateObject(cookedStrings, rawStrings);
}


export function unwrapSubstitutionsFromLocalizeCall(call: t.CallExpression): t.Expression[] {
  const expressions = call.arguments.splice(1);
  if (!isArrayOfExpressions(expressions)) {
    const badExpression = expressions.find(expression => !t.isExpression(expression)) !;
    throw new BabelParseError(
        badExpression,
        'Invalid substitutions for `$localize` (expected all substitution arguments to be expressions).');
  }
  return expressions;
}

export function unwrapMessagePartsFromTemplateLiteral(elements: t.TemplateElement[]):
    TemplateStringsArray {
  const cooked = elements.map(q => {
    if (q.value.cooked === undefined) {
      throw new BabelParseError(
          q, `Unexpected undefined message part in "${elements.map(q => q.value.cooked)}"`);
    }
    return q.value.cooked;
  });
  const raw = elements.map(q => q.value.raw);
  return ɵmakeTemplateObject(cooked, raw);
}

/**
* Wrap the given `expression` in parentheses if it is a binary expression.
*
* This ensures that this expression is evaluated correctly if it is embedded in another expression.
*
* @param expression The expression to potentially wrap.
*/
export function wrapInParensIfNecessary(expression: t.Expression): t.Expression {
  if (t.isBinaryExpression(expression)) {
    return t.parenthesizedExpression(expression);
  } else {
    return expression;
  }
}

/**
* Extract the string values from an `array` of string literals.
* @param array The array to unwrap.
*/
export function unwrapStringLiteralArray(array: t.Expression): string[] {
  if (!isStringLiteralArray(array)) {
    throw new BabelParseError(
        array, 'Unexpected messageParts for `$localize` (expected an array of strings).');
  }
  return array.elements.map((str: t.StringLiteral) => str.value);
}

/**
* Is the given `node` an array of literal strings?
*
* @param node The node to test.
*/
export function isStringLiteralArray(node: t.Node): node is t.Expression&
    {elements: t.StringLiteral[]} {
  return t.isArrayExpression(node) && node.elements.every(element => t.isStringLiteral(element));
}

/**
* Are all the given `nodes` expressions?
* @param nodes The nodes to test.
*/
export function isArrayOfExpressions(nodes: t.Node[]): nodes is t.Expression[] {
  return nodes.every(element => t.isExpression(element));
}

/** Options that affect how the `makeEsXXXTranslatePlugin()` functions work. */
export interface TranslatePluginOptions {
  missingTranslation?: MissingTranslationStrategy;
  localizeName?: string;
}

/**
 * How to handle missing translations.
 */
export type MissingTranslationStrategy = 'error' | 'warning' | 'ignore';

/**
 * Translate the text of the given message, using the given translations.
 *
 * Logs as warning if the translation is not available
 */
export function translate(
    diagnostics: Diagnostics, translations: Record<string, ɵParsedTranslation>,
    messageParts: TemplateStringsArray, substitutions: readonly any[],
    missingTranslation: MissingTranslationStrategy): [TemplateStringsArray, readonly any[]] {
  try {
    return ɵtranslate(translations, messageParts, substitutions);
  } catch (e) {
    if (ɵisMissingTranslationError(e)) {
      if (missingTranslation === 'error') {
        diagnostics.error(e.message);
      } else if (missingTranslation === 'warning') {
        diagnostics.warn(e.message);
      }
    } else {
      diagnostics.error(e.message);
    }
    return [messageParts, substitutions];
  }
}

export class BabelParseError extends Error {
  private readonly type = 'BabelParseError';
  constructor(public node: t.BaseNode, message: string) { super(message); }
}

export function isBabelParseError(e: any): e is BabelParseError {
  return e.type === 'BabelParseError';
}
