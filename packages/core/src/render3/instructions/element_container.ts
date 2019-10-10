/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import {assertDataInRange, assertEqual} from '../../util/assert';
import {assertHasParent} from '../assert';
import {attachPatchData} from '../context_discovery';
import {registerPostOrderHooks} from '../hooks';
import {TAttributes, TNodeType} from '../interfaces/node';
import {isContentQueryHost, isDirectiveHost} from '../interfaces/type_checks';
import {BINDING_INDEX, HEADER_OFFSET, RENDERER, TVIEW, T_HOST} from '../interfaces/view';
import {assertNodeType} from '../node_assert';
import {appendChild} from '../node_manipulation';
import {getIsParent, getLView, getPreviousOrParentTNode, setIsNotParent, setPreviousOrParentTNode} from '../state';

import {createDirectivesInstances, executeContentQueries, getOrCreateTNode, resolveDirectives, saveResolvedLocalsInData} from './shared';
import {registerInitialStylingOnTNode} from './styling';



/**
 * Creates a logical container for other nodes (<ng-container>) backed by a comment node in the DOM.
 * The instruction must later be followed by `elementContainerEnd()` call.
 *
 * @param index Index of the element in the LView array
 * @param constsIndex Index of the container in the `consts` array.
 * @param localRefs A set of local reference bindings on the element.
 *
 * Even if this instruction accepts a set of attributes no actual attribute values are propagated to
 * the DOM (as a comment node can't have attributes). Attributes are here only for directive
 * matching purposes and setting initial inputs of directives.
 *
 * @codeGenApi
 */
export function ɵɵelementContainerStart(
    index: number, constsIndex?: number | null, localRefs?: string[] | null): void {
  const lView = getLView();
  const tView = lView[TVIEW];
  const renderer = lView[RENDERER];
  const tagName = 'ng-container';
  const tViewConsts = tView.consts;
  const consts = tViewConsts === null || constsIndex == null ? null : tViewConsts[constsIndex];
  ngDevMode && assertEqual(
                   lView[BINDING_INDEX], tView.bindingStartIndex,
                   'element containers should be created before any bindings');

  ngDevMode && ngDevMode.rendererCreateComment++;
  ngDevMode && assertDataInRange(lView, index + HEADER_OFFSET);
  const native = lView[index + HEADER_OFFSET] = renderer.createComment(ngDevMode ? tagName : '');

  ngDevMode && assertDataInRange(lView, index - 1);
  const tNode =
      getOrCreateTNode(tView, lView[T_HOST], index, TNodeType.ElementContainer, tagName, consts);

  if (consts && tView.firstTemplatePass) {
    // While ng-container doesn't necessarily support styling, we use the style context to identify
    // and execute directives on the ng-container.
    registerInitialStylingOnTNode(tNode, consts as TAttributes, 0);
  }

  appendChild(native, tNode, lView);
  attachPatchData(native, lView);

  if (tView.firstTemplatePass) {
    ngDevMode && ngDevMode.firstTemplatePass++;
    resolveDirectives(tView, lView, tNode, localRefs || null);
    if (tView.queries) {
      tView.queries.elementStart(tView, tNode);
    }
  }

  if (isDirectiveHost(tNode)) {
    createDirectivesInstances(tView, lView, tNode);
    executeContentQueries(tView, tNode, lView);
  }

  if (localRefs != null) {
    saveResolvedLocalsInData(lView, tNode);
  }
}

/**
 * Mark the end of the <ng-container>.
 *
 * @codeGenApi
 */
export function ɵɵelementContainerEnd(): void {
  let previousOrParentTNode = getPreviousOrParentTNode();
  const lView = getLView();
  const tView = lView[TVIEW];
  if (getIsParent()) {
    setIsNotParent();
  } else {
    ngDevMode && assertHasParent(previousOrParentTNode);
    previousOrParentTNode = previousOrParentTNode.parent !;
    setPreviousOrParentTNode(previousOrParentTNode, false);
  }

  ngDevMode && assertNodeType(previousOrParentTNode, TNodeType.ElementContainer);

  if (tView.firstTemplatePass) {
    registerPostOrderHooks(tView, previousOrParentTNode);
    if (isContentQueryHost(previousOrParentTNode)) {
      tView.queries !.elementEnd(previousOrParentTNode);
    }
  }
}

/**
 * Creates an empty logical container using {@link elementContainerStart}
 * and {@link elementContainerEnd}
 *
 * @param index Index of the element in the LView array
 * @param constsIndex Index of the container in the `consts` array.
 * @param localRefs A set of local reference bindings on the element.
 *
 * @codeGenApi
 */
export function ɵɵelementContainer(
    index: number, constsIndex?: number | null, localRefs?: string[] | null): void {
  ɵɵelementContainerStart(index, constsIndex, localRefs);
  ɵɵelementContainerEnd();
}
