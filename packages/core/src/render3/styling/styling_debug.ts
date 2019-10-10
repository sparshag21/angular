/**
* @license
* Copyright Google Inc. All Rights Reserved.
*
* Use of this source code is governed by an MIT-style license that can be
* found in the LICENSE file at https://angular.io/license
*/
import {StyleSanitizeFn} from '../../sanitization/style_sanitizer';
import {RElement} from '../interfaces/renderer';
import {ApplyStylingFn, LStylingData, TStylingConfig, TStylingContext, TStylingContextIndex} from '../interfaces/styling';
import {getCurrentStyleSanitizer} from '../state';
import {attachDebugObject} from '../util/debug_utils';
import {allowDirectStyling as _allowDirectStyling, getDefaultValue, getGuardMask, getProp, getPropValuesStartPosition, getValuesCount, hasConfig, isContextLocked, isSanitizationRequired} from '../util/styling_utils';

import {applyStylingViaContext} from './bindings';
import {activateStylingMapFeature} from './map_based_bindings';



/**
 * --------
 *
 * This file contains the core debug functionality for styling in Angular.
 *
 * To learn more about the algorithm see `TStylingContext`.
 *
 * --------
 */


/**
 * A debug/testing-oriented summary of a styling entry.
 *
 * A value such as this is generated as an artifact of the `DebugStyling`
 * summary.
 */
export interface LStylingSummary {
  /** The style/class property that the summary is attached to */
  prop: string;

  /** The last applied value for the style/class property */
  value: string|boolean|null;

  /** The binding index of the last applied style/class property */
  bindingIndex: number|null;
}

/**
 * A debug/testing-oriented summary of all styling entries for a `DebugNode` instance.
 */
export interface DebugStyling {
  /** The associated TStylingContext instance */
  context: TStylingContext;

  /** Which configuration flags are active (see `TStylingContextConfig`) */
  config: {
    hasMapBindings: boolean;          //
    hasPropBindings: boolean;         //
    hasCollisions: boolean;           //
    hasTemplateBindings: boolean;     //
    hasHostBindings: boolean;         //
    templateBindingsLocked: boolean;  //
    hostBindingsLocked: boolean;      //
    allowDirectStyling: boolean;      //
  };

  /**
   * A summarization of each style/class property
   * present in the context
   */
  summary: {[propertyName: string]: LStylingSummary};

  /**
   * A key/value map of all styling properties and their
   * runtime values
   */
  values: {[propertyName: string]: string | number | null | boolean};

  /**
   * Overrides the sanitizer used to process styles
   */
  overrideSanitizer(sanitizer: StyleSanitizeFn|null): void;
}

/**
 * A debug/testing-oriented summary of all styling entries within a `TStylingContext`.
 */
export interface TStylingTupleSummary {
  /** The property (style or class property) that this tuple represents */
  prop: string;

  /** The total amount of styling entries a part of this tuple */
  valuesCount: number;

  /**
   * The bit guard mask that is used to compare and protect against
   * styling changes when any template style/class bindings update
   */
  templateBitMask: number;

  /**
   * The bit guard mask that is used to compare and protect against
   * styling changes when any host style/class bindings update
   */
  hostBindingsBitMask: number;

  /**
   * Whether or not the entry requires sanitization
   */
  sanitizationRequired: boolean;

  /**
   * The default value that will be applied if any bindings are falsy
   */
  defaultValue: string|boolean|null;

  /**
   * All bindingIndex sources that have been registered for this style
   */
  sources: (number|null|string)[];
}

/**
 * Instantiates and attaches an instance of `TStylingContextDebug` to the provided context
 */
export function attachStylingDebugObject(context: TStylingContext) {
  const debug = new TStylingContextDebug(context);
  attachDebugObject(context, debug);
  return debug;
}

/**
 * A human-readable debug summary of the styling data present within `TStylingContext`.
 *
 * This class is designed to be used within testing code or when an
 * application has `ngDevMode` activated.
 */
class TStylingContextDebug {
  constructor(public readonly context: TStylingContext) {}

  get isTemplateLocked() { return isContextLocked(this.context, true); }
  get isHostBindingsLocked() { return isContextLocked(this.context, false); }

  /**
   * Returns a detailed summary of each styling entry in the context.
   *
   * See `TStylingTupleSummary`.
   */
  get entries(): {[prop: string]: TStylingTupleSummary} {
    const context = this.context;
    const totalColumns = getValuesCount(context);
    const entries: {[prop: string]: TStylingTupleSummary} = {};
    const start = getPropValuesStartPosition(context);
    let i = start;
    while (i < context.length) {
      const prop = getProp(context, i);
      const templateBitMask = getGuardMask(context, i, false);
      const hostBindingsBitMask = getGuardMask(context, i, true);
      const defaultValue = getDefaultValue(context, i);
      const sanitizationRequired = isSanitizationRequired(context, i);
      const bindingsStartPosition = i + TStylingContextIndex.BindingsStartOffset;

      const sources: (number | string | null)[] = [];

      for (let j = 0; j < totalColumns; j++) {
        const bindingIndex = context[bindingsStartPosition + j] as number | string | null;
        if (bindingIndex !== 0) {
          sources.push(bindingIndex);
        }
      }

      entries[prop] = {
        prop,
        templateBitMask,
        hostBindingsBitMask,
        sanitizationRequired,
        valuesCount: sources.length, defaultValue, sources,
      };

      i += TStylingContextIndex.BindingsStartOffset + totalColumns;
    }
    return entries;
  }
}

/**
 * A human-readable debug summary of the styling data present for a `DebugNode` instance.
 *
 * This class is designed to be used within testing code or when an
 * application has `ngDevMode` activated.
 */
export class NodeStylingDebug implements DebugStyling {
  private _sanitizer: StyleSanitizeFn|null = null;

  constructor(
      public context: TStylingContext, private _data: LStylingData,
      private _isClassBased?: boolean) {}

  /**
   * Overrides the sanitizer used to process styles.
   */
  overrideSanitizer(sanitizer: StyleSanitizeFn|null) { this._sanitizer = sanitizer; }

  /**
   * Returns a detailed summary of each styling entry in the context and
   * what their runtime representation is.
   *
   * See `LStylingSummary`.
   */
  get summary(): {[key: string]: LStylingSummary} {
    const entries: {[key: string]: LStylingSummary} = {};
    this._mapValues((prop: string, value: any, bindingIndex: number | null) => {
      entries[prop] = {prop, value, bindingIndex};
    });
    return entries;
  }

  get config() {
    const hasMapBindings = hasConfig(this.context, TStylingConfig.HasMapBindings);
    const hasPropBindings = hasConfig(this.context, TStylingConfig.HasPropBindings);
    const hasCollisions = hasConfig(this.context, TStylingConfig.HasCollisions);
    const hasTemplateBindings = hasConfig(this.context, TStylingConfig.HasTemplateBindings);
    const hasHostBindings = hasConfig(this.context, TStylingConfig.HasHostBindings);
    const templateBindingsLocked = hasConfig(this.context, TStylingConfig.TemplateBindingsLocked);
    const hostBindingsLocked = hasConfig(this.context, TStylingConfig.HostBindingsLocked);
    const allowDirectStyling =
        _allowDirectStyling(this.context, false) || _allowDirectStyling(this.context, true);

    return {
        hasMapBindings,          //
        hasPropBindings,         //
        hasCollisions,           //
        hasTemplateBindings,     //
        hasHostBindings,         //
        templateBindingsLocked,  //
        hostBindingsLocked,      //
        allowDirectStyling,      //
    };
  }

  /**
   * Returns a key/value map of all the styles/classes that were last applied to the element.
   */
  get values(): {[key: string]: any} {
    const entries: {[key: string]: any} = {};
    this._mapValues((prop: string, value: any) => { entries[prop] = value; });
    return entries;
  }

  private _mapValues(fn: (prop: string, value: string|null, bindingIndex: number|null) => any) {
    // there is no need to store/track an element instance. The
    // element is only used when the styling algorithm attempts to
    // style the value (and we mock out the stylingApplyFn anyway).
    const mockElement = {} as any;
    const hasMaps = hasConfig(this.context, TStylingConfig.HasMapBindings);
    if (hasMaps) {
      activateStylingMapFeature();
    }

    const mapFn: ApplyStylingFn =
        (renderer: any, element: RElement, prop: string, value: string | null,
         bindingIndex?: number | null) => fn(prop, value, bindingIndex || null);

    const sanitizer = this._isClassBased ? null : (this._sanitizer || getCurrentStyleSanitizer());

    // run the template bindings
    applyStylingViaContext(
        this.context, null, mockElement, this._data, true, mapFn, sanitizer, false);

    // and also the host bindings
    applyStylingViaContext(
        this.context, null, mockElement, this._data, true, mapFn, sanitizer, true);
  }
}
