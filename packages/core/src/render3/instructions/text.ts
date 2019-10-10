/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import {assertDataInRange, assertEqual} from '../../util/assert';
import {TNodeType} from '../interfaces/node';
import {BINDING_INDEX, HEADER_OFFSET, RENDERER, TVIEW, T_HOST} from '../interfaces/view';
import {appendChild, createTextNode} from '../node_manipulation';
import {getLView, setIsNotParent} from '../state';
import {getOrCreateTNode} from './shared';



/**
 * Create static text node
 *
 * @param index Index of the node in the data array
 * @param value Static string value to write.
 *
 * @codeGenApi
 */
export function ɵɵtext(index: number, value: string = ''): void {
  const lView = getLView();
  ngDevMode && assertEqual(
                   lView[BINDING_INDEX], lView[TVIEW].bindingStartIndex,
                   'text nodes should be created before any bindings');
  ngDevMode && assertDataInRange(lView, index + HEADER_OFFSET);
  const textNative = lView[index + HEADER_OFFSET] = createTextNode(value, lView[RENDERER]);
  const tNode = getOrCreateTNode(lView[TVIEW], lView[T_HOST], index, TNodeType.Element, null, null);

  // Text nodes are self closing.
  setIsNotParent();
  appendChild(textNative, tNode, lView);
}
